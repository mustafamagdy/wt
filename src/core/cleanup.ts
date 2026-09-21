import { availableParallelism } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, isAbsolute } from "node:path";
import type { WorktreeRecord } from "./model.js";
import { parseWorktreePorcelain } from "./parser.js";
import { SystemAsyncGitRunner, type AsyncGitRunner, type GitRunResult } from "./runner.js";

/** Why a worktree can be removed without losing commits or local edits. */
export type CleanReason = "merged" | "squash-merged" | "pushed" | "missing";

/** Why a worktree must stay. */
export type KeepReason = "primary" | "bare" | "locked" | "current" | "dirty" | "unpushed" | "error";

export type CleanVerdict =
  | { removable: true; reason: CleanReason }
  | { removable: false; reason: KeepReason; detail?: string };

export interface CleanCandidate {
  /** Absolute common Git directory; the repository identity. */
  repository: string;
  /** Human-friendly repository name for grouping. */
  repositoryName: string;
  worktree: WorktreeRecord;
  /** Short branch name, when the worktree is attached to a branch. */
  branch?: string;
  verdict: CleanVerdict;
}

export interface AnalyzeCleanupOptions {
  /** Any paths inside the repositories to inspect. Duplicates are collapsed. */
  paths: readonly string[];
  /** Only inspect registrations under this directory. All registrations when omitted. */
  within?: string;
  /** Run `git fetch --all --prune` once per repository first. Default true. */
  fetch?: boolean;
  /** Worktree containing the caller's cwd; never removed. */
  currentPath?: string;
  concurrency?: number;
  runner?: AsyncGitRunner;
  /** Called when a repository fetch fails; analysis continues with local refs. */
  onFetchError?: (repository: string, message: string) => void;
}

export interface CleanupResult {
  candidate: CleanCandidate;
  ok: boolean;
  error?: string;
  branchDeleted?: boolean;
}

export interface ExecuteCleanupOptions {
  deleteBranch?: boolean;
  concurrency?: number;
  runner?: AsyncGitRunner;
}

interface RepositoryState {
  repository: string;
  name: string;
  records: WorktreeRecord[];
  bases: string[];
}

const defaultConcurrency = () => Math.max(4, Math.min(16, availableParallelism() * 2));

/** Classify worktrees as removable or not. All Git calls run concurrently, bounded by `concurrency`. */
export async function analyzeCleanup(options: AnalyzeCleanupOptions): Promise<CleanCandidate[]> {
  const runner = options.runner ?? new SystemAsyncGitRunner();
  const limit = createLimiter(options.concurrency ?? defaultConcurrency());
  const git = (args: string[], cwd: string) => limit(() => runner.run({ args, cwd }));
  const current = options.currentPath ? canonical(options.currentPath) : undefined;
  const within = options.within ? canonical(options.within) : undefined;

  const commonDirs = await Promise.all(options.paths.map(async (path) => {
    const result = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], path);
    return result.exitCode === 0 ? canonical(result.stdout.trim()) : undefined;
  }));
  const repositories = [...new Set(commonDirs.filter((dir): dir is string => Boolean(dir)))];

  const states = await Promise.all(repositories.map(async (repository): Promise<RepositoryState> => {
    if (options.fetch !== false) {
      const fetched = await git(["fetch", "--all", "--prune", "--quiet"], repository);
      if (fetched.exitCode !== 0) options.onFetchError?.(repository, failure(fetched));
    }
    const [listed, bases, name] = await Promise.all([
      git(["worktree", "list", "--porcelain", "-z"], repository),
      resolveBases(git, repository),
      repositoryDisplayName(git, repository),
    ]);
    const records = listed.exitCode === 0 ? parseWorktreePorcelain(listed.stdout) : [];
    return { repository, name, records, bases };
  }));

  const jobs = states.flatMap((state) => state.records.map((record, index) => ({ state, record, primary: index === 0 })))
    .filter(({ record }) => !within || isInside(within, canonical(record.path)));

  return Promise.all(jobs.map(async ({ state, record, primary }) => {
    const branch = record.branch?.replace(/^refs\/heads\//, "");
    let verdict: CleanVerdict;
    try {
      verdict = await classify(git, state, record, primary, current);
    } catch (error) {
      verdict = { removable: false, reason: "error", detail: error instanceof Error ? error.message : String(error) };
    }
    return {
      repository: state.repository,
      repositoryName: state.name,
      worktree: record,
      ...(branch ? { branch } : {}),
      verdict,
    };
  }));
}

type Git = (args: string[], cwd: string) => Promise<GitRunResult>;

async function classify(
  git: Git,
  state: RepositoryState,
  record: WorktreeRecord,
  primary: boolean,
  current: string | undefined,
): Promise<CleanVerdict> {
  if (record.bare) return { removable: false, reason: "bare" };
  if (primary) return { removable: false, reason: "primary" };
  if (record.locked) return { removable: false, reason: "locked", ...(record.lockReason ? { detail: record.lockReason } : {}) };
  if (record.prunable) return { removable: true, reason: "missing" };
  if (current && canonical(record.path) === current) return { removable: false, reason: "current" };

  const status = await git(["status", "--porcelain", "--untracked-files=normal"], record.path);
  if (status.exitCode !== 0) return { removable: false, reason: "error", detail: failure(status) };
  if (status.stdout.length > 0) return { removable: false, reason: "dirty" };

  const head = record.head;
  const [merged, squashed, pushed] = await Promise.all([
    anyAsync(state.bases, async (base) => (await git(["merge-base", "--is-ancestor", head, base], state.repository)).exitCode === 0),
    record.branch ? anyAsync(state.bases, (base) => isSquashMerged(git, state.repository, head, base)) : Promise.resolve(false),
    git(["for-each-ref", "--contains", head, "--count=1", "--format=%(refname)", "refs/remotes"], state.repository)
      .then((result) => result.exitCode === 0 && result.stdout.trim().length > 0),
  ]);
  if (merged) return { removable: true, reason: "merged" };
  if (squashed) return { removable: true, reason: "squash-merged" };
  if (pushed) return { removable: true, reason: "pushed" };
  return { removable: false, reason: "unpushed" };
}

/**
 * True when the branch's net change already exists in `base`, as after a
 * squash or rebase merge. The branch is collapsed into one temporary commit
 * on its merge base, then `git cherry` compares its patch id with base.
 */
async function isSquashMerged(git: Git, repository: string, head: string, base: string): Promise<boolean> {
  const mergeBase = await git(["merge-base", head, base], repository);
  if (mergeBase.exitCode !== 0) return false;
  const forkPoint = mergeBase.stdout.trim();
  if (forkPoint === head) return false;
  const squashed = await git([
    "-c", "user.name=wt", "-c", "user.email=wt@localhost",
    "commit-tree", `${head}^{tree}`, "-p", forkPoint, "-m", "wt clean probe",
  ], repository);
  if (squashed.exitCode !== 0) return false;
  const cherry = await git(["cherry", base, squashed.stdout.trim()], repository);
  return cherry.exitCode === 0 && cherry.stdout.trim().startsWith("-");
}

/** Default branch refs to compare against: origin's HEAD plus its local twin, else main/master. */
async function resolveBases(git: Git, repository: string): Promise<string[]> {
  const originHead = await git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], repository);
  const names = originHead.exitCode === 0
    ? [originHead.stdout.trim().replace(/^refs\/remotes\/origin\//, "")]
    : ["main", "master"];
  const refs = names.flatMap((name) => [`refs/remotes/origin/${name}`, `refs/heads/${name}`]);
  const present = await Promise.all(refs.map(async (ref) =>
    (await git(["show-ref", "--verify", "--quiet", ref], repository)).exitCode === 0 ? ref : undefined));
  return present.filter((ref): ref is string => Boolean(ref));
}

async function repositoryDisplayName(git: Git, repository: string): Promise<string> {
  const origin = await git(["config", "--get", "remote.origin.url"], repository);
  if (origin.exitCode === 0 && origin.stdout.trim()) return basename(origin.stdout.trim().replace(/\.git$/, ""));
  return basename(repository) === ".git" ? basename(dirname(repository)) : basename(repository).replace(/\.git$/, "");
}

/**
 * Remove the chosen worktrees in parallel. Missing registrations are pruned,
 * and branch deletion runs once per repository to avoid ref lock contention.
 */
export async function executeCleanup(
  candidates: readonly CleanCandidate[],
  options: ExecuteCleanupOptions = {},
): Promise<CleanupResult[]> {
  const runner = options.runner ?? new SystemAsyncGitRunner();
  const limit = createLimiter(options.concurrency ?? defaultConcurrency());
  const git = (args: string[], cwd: string) => limit(() => runner.run({ args, cwd }));
  const removable = candidates.filter((candidate) => candidate.verdict.removable);

  const pruneRepositories = [...new Set(removable.filter((c) => c.worktree.prunable).map((c) => c.repository))];
  const pruned = new Map(await Promise.all(pruneRepositories.map(async (repository) =>
    [repository, await git(["worktree", "prune"], repository)] as const)));

  const results = await Promise.all(removable.map(async (candidate): Promise<CleanupResult> => {
    const result = candidate.worktree.prunable
      ? pruned.get(candidate.repository)!
      : await git(["worktree", "remove", candidate.worktree.path], candidate.repository);
    return result.exitCode === 0 ? { candidate, ok: true } : { candidate, ok: false, error: failure(result) };
  }));

  if (options.deleteBranch) {
    const byRepository = new Map<string, CleanupResult[]>();
    for (const result of results) {
      if (!result.ok || !result.candidate.branch) continue;
      byRepository.set(result.candidate.repository, [...(byRepository.get(result.candidate.repository) ?? []), result]);
    }
    await Promise.all([...byRepository].map(async ([repository, group]) => {
      for (const result of group) {
        const deleted = await runner.run({ args: ["branch", "-D", result.candidate.branch!], cwd: repository });
        result.branchDeleted = deleted.exitCode === 0;
        if (!result.branchDeleted) result.error = `worktree removed, branch kept: ${failure(deleted)}`;
      }
    }));
  }
  return results;
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    // A finishing task hands its slot straight to the next waiter, so `active` never overshoots.
    if (active >= concurrency) await new Promise<void>((acquire) => queue.push(acquire));
    else active += 1;
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

async function anyAsync<T>(items: readonly T[], predicate: (item: T) => Promise<boolean>): Promise<boolean> {
  return (await Promise.all(items.map(predicate))).some(Boolean);
}

function failure(result: GitRunResult): string {
  return result.stderr.trim() || result.stdout.trim() || `Git exited with ${result.exitCode}`;
}

function canonical(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}
