import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import { folderFromBranch } from "./config.js";
import { GitWorktreeError } from "./errors.js";
import { branchAt, git, gitOk, hasChanges, optionalGitText, requireRepository } from "./git.js";
import { SystemAsyncGitRunner, type AsyncGitRunner } from "./runner.js";
import {
  branchExists,
  describeWorktree,
  directorySize,
  managedWorktreePaths,
  registeredWorktreePaths,
  type Worktree,
} from "./worktrees.js";

/*
 * Non-interactive operations on managed worktrees. They never prompt or print:
 * every outcome is a return value or a GitWorktreeError with a stable `code`,
 * so the human CLI and agent-facing tools share one implementation.
 */

export interface CopyResult {
  pattern: string;
  /** Files or directories copied for this pattern; 0 when nothing matched. */
  count: number;
}

export interface CreateWorktreeOptions {
  /** Any path inside the source repository. Defaults to the process cwd. */
  cwd?: string;
  /** Managed worktree directory. */
  root: string;
  branch: string;
  /** Local or origin branch to start from. Current HEAD when omitted. */
  base?: string;
  /** Replace an existing registered worktree at the target path. */
  force?: boolean;
  /** File or glob patterns, relative to the repository, to copy into the new worktree. */
  copy?: readonly string[];
}

export interface CreateWorktreeResult {
  path: string;
  branch: string;
  repository: string;
  /** Ref the branch was created from, when a base was given. */
  startPoint?: string;
  copied: CopyResult[];
}

export function repositoryRoot(cwd = process.cwd()): string {
  return requireRepository(cwd);
}

export function currentBranch(cwd = process.cwd()): string {
  return branchAt(requireRepository(cwd));
}

export function createWorktree(options: CreateWorktreeOptions): CreateWorktreeResult {
  const repository = requireRepository(options.cwd);
  const { branch, base } = options;
  if (!branch.trim()) throw new GitWorktreeError("Branch name is required.", { code: "INVALID_ARGUMENT" });
  mkdirSync(options.root, { recursive: true });
  if (branchExists(branch, repository).local) {
    throw new GitWorktreeError(`Branch '${branch}' already exists.`, { code: "BRANCH_EXISTS" });
  }

  let startPoint = base;
  if (base) {
    const baseExists = branchExists(base, repository);
    if (!baseExists.local && !baseExists.remote) {
      throw new GitWorktreeError(`Base branch '${base}' does not exist locally or on origin.`, { code: "BRANCH_NOT_FOUND" });
    }
    if (!baseExists.local) startPoint = `origin/${base}`;
  }

  const target = join(options.root, folderFromBranch(branch));
  if (existsSync(target) && !options.force) {
    throw new GitWorktreeError(`Folder already exists: ${target}.`, { code: "TARGET_EXISTS" });
  }
  removeRegisteredTarget(repository, target, Boolean(options.force));

  const args = ["worktree", "add", "-b", branch, target];
  if (startPoint) args.push(startPoint);
  git(args, repository);
  const copied = options.copy?.length ? copyIntoWorktree(repository, target, options.copy) : [];
  return { path: target, branch, repository, ...(startPoint ? { startPoint } : {}), copied };
}

/** Copy matching untracked files or directories from a repository into a worktree. */
export function copyIntoWorktree(repository: string, target: string, patterns: readonly string[]): CopyResult[] {
  const results: CopyResult[] = [];
  for (const pattern of patterns.map((value) => value.trim()).filter(Boolean)) {
    const matches = fg.sync(pattern, {
      cwd: repository,
      dot: true,
      onlyFiles: false,
      followSymbolicLinks: false,
      unique: true,
      ignore: [".git", ".git/**"],
    });
    for (const relative of matches) {
      const source = resolve(repository, relative);
      const destination = resolve(target, relative);
      if (!source.startsWith(`${resolve(repository)}/`) || !destination.startsWith(`${resolve(target)}/`)) {
        throw new GitWorktreeError(`Copy pattern escaped the repository: ${relative}`, { code: "INVALID_ARGUMENT" });
      }
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true, dereference: false, force: true });
    }
    results.push({ pattern, count: matches.length });
  }
  return results;
}

export interface CheckoutWorktreeOptions {
  cwd?: string;
  root: string;
  branch: string;
  force?: boolean;
}

export interface CheckoutWorktreeResult {
  path: string;
  branch: string;
  /** True when a matching worktree already existed and nothing changed. */
  reused: boolean;
  /** True when the branch only existed on origin and a local tracking branch was created. */
  fromOrigin: boolean;
}

export function checkoutWorktree(options: CheckoutWorktreeOptions): CheckoutWorktreeResult {
  const repository = requireRepository(options.cwd);
  const { branch } = options;
  mkdirSync(options.root, { recursive: true });
  const existing = branchExists(branch, repository);
  if (!existing.local && !existing.remote) {
    throw new GitWorktreeError(`Branch '${branch}' does not exist locally or on origin.`, { code: "BRANCH_NOT_FOUND" });
  }
  const target = join(options.root, folderFromBranch(branch));

  if (existsSync(`${target}/.git`)) {
    const registered = registeredWorktreePaths(repository).some((path) => samePath(path, target));
    if (!registered) {
      throw new GitWorktreeError(`Refusing to use an unregistered Git directory: ${target}. Move it away first.`, { code: "UNREGISTERED_TARGET" });
    }
    const checkedOut = branchAt(target);
    if (checkedOut !== branch) {
      throw new GitWorktreeError(`Registered worktree at ${target} has branch '${checkedOut}', not '${branch}'.`, { code: "WORKTREE_MISMATCH" });
    }
    return { path: target, branch, reused: true, fromOrigin: false };
  }
  if (existsSync(target) && !options.force) {
    throw new GitWorktreeError(`Folder already exists: ${target}.`, { code: "TARGET_EXISTS" });
  }
  if (existsSync(target)) {
    throw new GitWorktreeError(`Refusing to delete an unregistered directory: ${target}. Move it away first.`, { code: "UNREGISTERED_TARGET" });
  }
  const fromOrigin = !existing.local && existing.remote;
  const args = ["worktree", "add"];
  if (fromOrigin) args.push("-b", branch);
  args.push(target, existing.local ? branch : `origin/${branch}`);
  git(args, repository);
  return { path: target, branch, reused: false, fromOrigin };
}

export interface TimeWorktreeOptions {
  cwd?: string;
  root: string;
  branch: string;
  /** YYYY-MM-DD; the worktree checks out the last commit on or before this day. */
  date: string;
  force?: boolean;
}

export interface TimeWorktreeResult {
  path: string;
  branch: string;
  date: string;
  commit: string;
}

export function timeWorktree(options: TimeWorktreeOptions): TimeWorktreeResult {
  const { branch, date } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GitWorktreeError("Date must use YYYY-MM-DD format.", { code: "INVALID_ARGUMENT" });
  const repository = requireRepository(options.cwd);
  const commit = optionalGitText(["rev-list", "-n", "1", `--before=${date} 23:59`, branch], repository);
  if (!commit) throw new GitWorktreeError(`No commit on '${branch}' before ${date}.`, { code: "NO_COMMIT" });
  mkdirSync(options.root, { recursive: true });
  const target = join(options.root, folderFromBranch(`${branch}-${date}`));
  if (existsSync(target) && !options.force) {
    throw new GitWorktreeError(`Folder already exists: ${target}.`, { code: "TARGET_EXISTS" });
  }
  removeRegisteredTarget(repository, target, Boolean(options.force));
  git(["worktree", "add", "--detach", target, commit], repository);
  return { path: target, branch, date, commit };
}

/**
 * Worktrees in the managed directory chosen by a selector. An exact branch,
 * folder name, or path wins; otherwise branches containing the selector
 * (case-insensitive) match. Callers decide what to do with several matches.
 */
export function selectWorktrees(root: string, selector: string): Worktree[] {
  const all = managedWorktreePaths(root)
    .map((path) => describeWorktree(path))
    .filter((item): item is Worktree => Boolean(item));
  const exact = all.filter((item) => item.branch === selector || basename(item.path) === selector || samePath(item.path, resolve(selector)));
  if (exact.length) return exact;
  const needle = selector.toLowerCase();
  return all.filter((item) => item.branch.toLowerCase().includes(needle));
}

export interface WorktreeStatus {
  path: string;
  branch: string;
  upstream?: string;
  /** Commits not on the upstream; absent when there is no upstream. */
  ahead?: number;
  /** Upstream commits not in the worktree; absent when there is no upstream. */
  behind?: number;
  dirty: boolean;
  /** Changed or untracked paths. */
  changes: number;
  /** Bytes on disk, only when requested. */
  size?: number;
}

/** Facts needed before removing or syncing a worktree. */
export function inspectWorktree(path: string, options: { size?: boolean } = {}): WorktreeStatus {
  if (!existsSync(path)) throw new GitWorktreeError(`No worktree at ${path}.`, { code: "NOT_REGISTERED" });
  const branch = branchAt(path);
  const upstream = optionalGitText(["rev-parse", "--abbrev-ref", "@{u}"], path);
  const counts = upstream ? optionalGitText(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], path) : undefined;
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [];
  const changes = git(["status", "--porcelain"], path).stdout.split("\n").filter(Boolean).length;
  return {
    path,
    branch,
    ...(upstream ? { upstream, ahead: ahead ?? 0, behind: behind ?? 0 } : {}),
    dirty: changes > 0,
    changes,
    ...(options.size ? { size: directorySize(path) } : {}),
  };
}

/** Remove one registered worktree. Its branch is kept. Refuses uncommitted changes unless `force`. */
export function removeWorktree(path: string, options: { force?: boolean } = {}): { path: string } {
  const repository = registeredWorktreePaths(path)[0];
  if (!repository) throw new GitWorktreeError("Git did not report a primary worktree for this repository.", { code: "NOT_REGISTERED" });
  const args = ["worktree", "remove"];
  if (options.force) args.push("--force");
  args.push(path);
  git(args, repository);
  return { path };
}

export interface RemoveResult {
  path: string;
  ok: boolean;
  error?: string;
}

/** Remove several worktrees in parallel; failures are reported per worktree, not thrown. */
export async function removeWorktrees(
  paths: readonly string[],
  options: { force?: boolean; runner?: AsyncGitRunner } = {},
): Promise<RemoveResult[]> {
  const runner = options.runner ?? new SystemAsyncGitRunner();
  return Promise.all(paths.map(async (path) => {
    const common = optionalGitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], path) ?? path;
    const result = await runner.run({ args: ["worktree", "remove", ...(options.force ? ["--force"] : []), path], cwd: common });
    return result.exitCode === 0
      ? { path, ok: true }
      : { path, ok: false, error: result.stderr.trim() || result.stdout.trim() };
  }));
}

/** Unpushed commit counts for worktrees with an upstream, checked in parallel. */
export async function unpushedCounts(
  items: readonly Worktree[],
  runner: AsyncGitRunner = new SystemAsyncGitRunner(),
): Promise<Map<string, number>> {
  return new Map(await Promise.all(items.filter((item) => item.upstream).map(async (item) => {
    const result = await runner.run({ args: ["rev-list", "--count", "@{u}..HEAD"], cwd: item.path });
    return [item.path, result.exitCode === 0 ? Number(result.stdout.trim()) : 0] as const;
  })));
}

export type SyncStep = "fetch" | "stash" | "rebase" | "merge";

export interface SyncResult {
  path: string;
  branch: string;
  /** Branch synced onto, such as `origin/main`. */
  target: string;
  fetched: boolean;
  method: "rebase" | "merge";
  stashed: boolean;
  /** False when stashed changes could not be restored and remain in the stash. */
  stashRestored: boolean;
}

/**
 * Rebase a worktree onto origin/main (or master, or the local equivalents),
 * falling back to a merge, while stashing and restoring local changes.
 */
export function syncWorktree(path: string, options: { onStep?: (step: SyncStep, detail: string) => void } = {}): SyncResult {
  const branch = branchAt(path);
  const candidates = ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
  const found = candidates.find((ref) => gitOk(["show-ref", "--verify", "--quiet", ref], path));
  if (!found) throw new GitWorktreeError("No main or master branch exists locally or on origin.", { code: "NO_BASE_BRANCH" });
  const target = found.replace("refs/remotes/", "").replace("refs/heads/", "");
  const fetched = target.startsWith("origin/");
  if (fetched) {
    options.onStep?.("fetch", "origin");
    git(["fetch", "origin"], path);
  }

  const stashed = hasChanges(path);
  if (stashed) {
    options.onStep?.("stash", "local changes");
    git(["stash", "push", "--include-untracked", "-m", `wt sync auto-stash ${new Date().toISOString()}`], path);
  }
  options.onStep?.("rebase", `${branch} onto ${target}`);
  let method: SyncResult["method"] = "rebase";
  if (git(["rebase", target], path, true).status !== 0) {
    git(["rebase", "--abort"], path, true);
    options.onStep?.("merge", target);
    method = "merge";
    git(["merge", target], path);
  }
  const stashRestored = stashed ? git(["stash", "pop"], path, true).status === 0 : true;
  return { path, branch, target, fetched, method, stashed, stashRestored };
}

export function readTags(path: string): string[] {
  const file = join(path, ".wt-tags");
  return existsSync(file) ? readFileSync(file, "utf8").split(/\s+/).map((value) => value.trim()).filter(Boolean) : [];
}

/** Add a tag to a worktree. Adding a tag it already has changes nothing. */
export function addTag(path: string, tag: string): { tags: string[]; added: boolean } {
  if (!tag.trim() || /\s/.test(tag)) throw new GitWorktreeError("Tag must be a single word.", { code: "INVALID_ARGUMENT" });
  const tags = readTags(path);
  const added = !tags.includes(tag);
  const next = [...new Set([...tags, tag])].sort();
  writeFileSync(join(path, ".wt-tags"), `${next.join("\n")}\n`);
  return { tags: next, added };
}

/** Every tag in the managed directory with the number of worktrees carrying it. */
export function tagCounts(root: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of managedWorktreePaths(root).flatMap(readTags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export function worktreesWithTag(root: string, tag: string): string[] {
  return managedWorktreePaths(root).filter((path) => readTags(path).includes(tag));
}

/** Bytes used by each managed worktree, largest first. */
export function diskUsage(root: string): Array<{ path: string; size: number }> {
  return managedWorktreePaths(root)
    .map((path) => ({ path, size: directorySize(path) }))
    .sort((a, b) => b.size - a.size);
}

export interface PushOptions {
  cwd?: string;
  /** Commit message; required when there are uncommitted changes. */
  message?: string;
  /** Added as `origin` when the repository has no origin remote. */
  originUrl?: string;
}

export interface PushResult {
  branch: string;
  committed: boolean;
  originAdded: boolean;
}

/** Stage everything, commit when needed, and push the current branch to origin. */
export function commitAndPush(options: PushOptions = {}): PushResult {
  const repository = requireRepository(options.cwd);
  const committed = hasChanges(repository);
  if (committed) {
    if (!options.message?.trim()) throw new GitWorktreeError("A commit message is required to commit pending changes.", { code: "MESSAGE_REQUIRED" });
    git(["add", "-A"], repository);
    git(["commit", "-m", options.message], repository);
  }
  const branch = branchAt(repository);
  if (branch === "HEAD") throw new GitWorktreeError("Cannot push a detached HEAD.", { code: "DETACHED_HEAD" });
  let originAdded = false;
  if (!originUrl(repository)) {
    if (!options.originUrl) throw new GitWorktreeError("The repository has no origin remote.", { code: "NO_ORIGIN" });
    git(["remote", "add", "origin", options.originUrl], repository);
    originAdded = true;
  }
  git(["push", "-u", "origin", branch], repository);
  return { branch, committed, originAdded };
}

export function originUrl(cwd = process.cwd()): string | undefined {
  return optionalGitText(["remote", "get-url", "origin"], cwd);
}

export function hasUncommittedChanges(cwd = process.cwd()): boolean {
  return hasChanges(requireRepository(cwd));
}

/** Remove a registered worktree occupying `target`; refuse anything Git does not know. */
function removeRegisteredTarget(repository: string, target: string, force: boolean): void {
  if (!existsSync(target)) return;
  const registered = registeredWorktreePaths(repository).some((path) => samePath(path, target));
  if (!registered) {
    throw new GitWorktreeError(`Refusing to delete an unregistered directory: ${target}. Move it away first.`, { code: "UNREGISTERED_TARGET" });
  }
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(target);
  git(args, repository);
  if (existsSync(target)) {
    throw new GitWorktreeError(`Git removed the registration but the directory still exists: ${target}`, { code: "POSTCONDITION_FAILED" });
  }
}

function samePath(left: string, right: string): boolean {
  const canonical = (path: string) => existsSync(path) ? realpathSync.native(path) : resolve(path);
  return canonical(left) === canonical(right);
}
