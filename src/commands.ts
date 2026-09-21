import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import { analyzeCleanup, executeCleanup, type CleanCandidate } from "./core/cleanup.js";
import { SystemAsyncGitRunner } from "./core/runner.js";
import { parseWorktreePorcelain } from "./core/parser.js";
import { folderFromBranch } from "./config.js";
import { CliError } from "./errors.js";
import { branchAt, git, gitOk, gitRaw, hasChanges, optionalGitText, requireRepository } from "./git.js";
import { chooseMany, color, confirm, heading, input, renderTable, search, spinner, ui } from "./ui.js";
import {
  branchExists,
  directorySize,
  findManagedWorktrees,
  formatBytes,
  listWorktrees,
  managedWorktreePaths,
  registeredWorktreePaths,
  type Worktree,
} from "./worktrees.js";

export interface DirectoryOptions {
  dir: string;
}

export interface ForceOptions extends DirectoryOptions {
  force?: boolean;
}

async function resolveWorktree(root: string, partial: string | undefined): Promise<Worktree> {
  const matches = partial === undefined ? findManagedWorktrees(root, "") : findManagedWorktrees(root, partial);
  if (!matches.length) throw new CliError(partial === undefined ? "No managed worktrees found." : `No worktree found matching '${partial}'.`);
  if (matches.length === 1 && partial !== undefined) return matches[0]!;
  if (partial === undefined) requireTerminal("a worktree");
  const selected = await search(
    partial === undefined ? "Pick a worktree" : `Multiple worktrees match '${partial}'`,
    matches.map((match) => ({ value: match.path, label: match.branch, hint: worktreeHint(match) })),
  );
  return matches.find((match) => match.path === selected)!;
}

function worktreeHint(worktree: Worktree): string {
  return `${worktree.dirty ? "● uncommitted, " : ""}${worktree.project}, ${worktree.path}`;
}

/** Missing arguments are picked interactively; without a terminal they stay an error. */
function requireTerminal(what: string): void {
  if (!process.stdin.isTTY) throw new CliError(`Missing ${what}. Pass it as an argument, or run in a terminal to pick one.`);
}

/** Branches that exist locally or on origin, local first. */
function knownBranches(repository: string): Array<{ name: string; local: boolean }> {
  const refs = git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"], repository).stdout
    .split("\n").filter(Boolean);
  const local = new Set(refs.filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice("refs/heads/".length)));
  const remote = refs.filter((ref) => ref.startsWith("refs/remotes/origin/"))
    .map((ref) => ref.slice("refs/remotes/origin/".length))
    .filter((name) => name !== "HEAD" && !local.has(name));
  return [...[...local].map((name) => ({ name, local: true })), ...remote.map((name) => ({ name, local: false }))];
}

function openShell(cwd: string): void {
  if (!process.stdin.isTTY) return;
  const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
  const result = spawnSync(shell, [], { cwd, stdio: "inherit" });
  if (result.error) throw new CliError(`Unable to open ${shell}: ${result.error.message}`);
}

function removeTarget(root: string, target: string, force: boolean): void {
  if (!existsSync(target)) return;
  const registered = registeredWorktreePaths(root).some((path) => samePath(path, target));
  if (!registered) {
    throw new CliError(`Refusing to delete an unregistered directory: ${target}. Move it away first.`);
  }
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(target);
  git(args, root);
  if (existsSync(target)) throw new CliError(`Git removed the registration but the directory still exists: ${target}`);
}

function samePath(left: string, right: string): boolean {
  const canonical = (path: string) => existsSync(path) ? realpathSync.native(path) : resolve(path);
  return canonical(left) === canonical(right);
}

export async function listCommand(
  pattern: string | undefined,
  options: DirectoryOptions & { current?: boolean; json?: boolean },
): Promise<void> {
  const items = listWorktrees({ root: options.dir, current: Boolean(options.current), ...(pattern ? { pattern } : {}) });
  if (options.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  heading(options.current ? "Current repository worktrees" : "Managed worktrees");
  if (!items.length) {
    ui.info(pattern ? `No worktrees match '${pattern}'.` : "No worktrees found.");
    return;
  }
  renderTable(
    ["PROJECT", "BRANCH", "UPSTREAM", "PATH"],
    items.map((item) => [
      color.cyan(item.project),
      item.dirty ? color.yellow(`● ${item.branch}`) : color.green(item.branch),
      item.upstream ?? color.dim("—"),
      color.dim(item.path),
    ]),
  );
}

export async function createCommand(
  branchArgument: string | undefined,
  baseArgument: string | undefined,
  options: ForceOptions & { copy?: string; shell?: boolean },
): Promise<void> {
  const repository = requireRepository();
  let branch = branchArgument;
  let base = baseArgument;
  if (branch === undefined) {
    requireTerminal("a branch name");
    branch = await input("New branch name");
    const picked = await search("Start from", [
      { value: "", label: "current HEAD", hint: branchAt(repository) },
      ...knownBranches(repository).map((item) => ({ value: item.name, label: item.name, hint: item.local ? "local" : "origin" })),
    ]);
    base = picked || undefined;
  }
  mkdirSync(options.dir, { recursive: true });
  const existing = branchExists(branch, repository);
  if (existing.local) throw new CliError(`Branch '${branch}' already exists. Use 'wt checkout ${branch}'.`);

  let baseRef = base;
  if (base) {
    const baseExists = branchExists(base, repository);
    if (!baseExists.local && !baseExists.remote) throw new CliError(`Base branch '${base}' does not exist locally or on origin.`);
    if (!baseExists.local) baseRef = `origin/${base}`;
  }

  const target = join(options.dir, folderFromBranch(branch));
  if (existsSync(target) && !options.force) throw new CliError(`Folder already exists: ${target}. Use --force to replace it.`);
  removeTarget(repository, target, Boolean(options.force));

  const args = ["worktree", "add", "-b", branch, target];
  if (baseRef) args.push(baseRef);
  git(args, repository);
  if (options.copy) copyPatterns(repository, target, options.copy);
  ui.success(`Worktree ready at ${target}`);
  if (options.shell !== false) openShell(target);
}

function copyPatterns(repository: string, target: string, patterns: string): void {
  for (const pattern of patterns.split(",").map((value) => value.trim()).filter(Boolean)) {
    const matches = fg.sync(pattern, {
      cwd: repository,
      dot: true,
      onlyFiles: false,
      followSymbolicLinks: false,
      unique: true,
      ignore: [".git", ".git/**"],
    });
    if (!matches.length) {
      ui.warning(`No files match '${pattern}'; skipped.`);
      continue;
    }
    for (const relative of matches) {
      const source = resolve(repository, relative);
      const destination = resolve(target, relative);
      if (!source.startsWith(`${resolve(repository)}/`) || !destination.startsWith(`${resolve(target)}/`)) {
        throw new CliError(`Copy pattern escaped the repository: ${relative}`);
      }
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true, dereference: false, force: true });
    }
    ui.success(`Copied ${matches.length} item${matches.length === 1 ? "" : "s"} matching '${pattern}'.`);
  }
}

export async function checkoutCommand(branchArgument: string | undefined, options: ForceOptions & { shell?: boolean }): Promise<void> {
  const repository = requireRepository();
  let branch = branchArgument;
  if (branch === undefined) {
    requireTerminal("a branch");
    const checkedOut = new Set(parseWorktreePorcelain(gitRaw(["worktree", "list", "--porcelain", "-z"], repository).stdout)
      .map((item) => item.branch?.replace(/^refs\/heads\//, "")));
    const available = knownBranches(repository).filter((item) => !checkedOut.has(item.name));
    if (!available.length) throw new CliError("Every branch already has a worktree.");
    branch = await search("Branch to check out", available.map((item) => ({
      value: item.name,
      label: item.name,
      hint: item.local ? "local" : "origin only",
    })));
  }
  mkdirSync(options.dir, { recursive: true });
  const existing = branchExists(branch, repository);
  if (!existing.local && !existing.remote) throw new CliError(`Branch '${branch}' does not exist locally or on origin.`);
  const target = join(options.dir, folderFromBranch(branch));

  if (existsSync(`${target}/.git`)) {
    const registered = registeredWorktreePaths(repository).some((path) => samePath(path, target));
    if (!registered) throw new CliError(`Refusing to use an unregistered Git directory: ${target}. Move it away first.`);
    if (branchAt(target) !== branch) throw new CliError(`Registered worktree at ${target} has branch '${branchAt(target)}', not '${branch}'.`);
    ui.success(`Using existing worktree at ${target}`);
  } else {
    if (existsSync(target) && !options.force) throw new CliError(`Folder already exists: ${target}. Use --force to replace it.`);
    if (existsSync(target)) throw new CliError(`Refusing to delete an unregistered directory: ${target}. Move it away first.`);
    const args = ["worktree", "add"];
    if (!existing.local && existing.remote) args.push("-b", branch);
    args.push(target, existing.local ? branch : `origin/${branch}`);
    git(args, repository);
    ui.success(`Worktree ready at ${target}`);
  }
  if (options.shell !== false) openShell(target);
}

export async function switchCommand(partial: string | undefined, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  ui.info(`Opening ${selected.branch}`);
  openShell(selected.path);
}

export async function tagCommand(partial: string | undefined, tagArgument: string | undefined, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  const tagFile = join(selected.path, ".wt-tags");
  const tags = readTags(selected.path);
  let tag = tagArgument;
  if (tag === undefined) {
    requireTerminal("a tag");
    const known = [...new Set(managedWorktreePaths(options.dir).flatMap(readTags))].sort();
    tag = await input(`Tag for '${selected.branch}'`, known.length ? `existing: ${known.join(", ")}` : undefined);
  }
  if (!tags.includes(tag)) tags.push(tag);
  writeFileSync(tagFile, `${[...new Set(tags)].sort().join("\n")}\n`);
  ui.success(`Tagged '${selected.branch}' as '${tag}'.`);
}

function readTags(path: string): string[] {
  const file = join(path, ".wt-tags");
  return existsSync(file) ? readFileSync(file, "utf8").split(/\s+/).map((value) => value.trim()).filter(Boolean) : [];
}

export async function switchGroupCommand(tagArgument: string | undefined, options: DirectoryOptions): Promise<void> {
  const paths = managedWorktreePaths(options.dir);
  let tag = tagArgument;
  if (tag === undefined) {
    requireTerminal("a tag");
    const counts = new Map<string, number>();
    for (const found of paths.flatMap(readTags)) counts.set(found, (counts.get(found) ?? 0) + 1);
    if (!counts.size) throw new CliError("No worktree has a tag yet. Add one with 'wt tag'.");
    tag = await search("Pick a tag", [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({
      value: name,
      label: name,
      hint: `${count} worktree${count === 1 ? "" : "s"}`,
    })));
  }
  const matches = paths.filter((path) => readTags(path).includes(tag));
  if (!matches.length) throw new CliError(`No worktree tagged '${tag}'.`);
  const selected = matches.length === 1
    ? matches[0]!
    : await search(
        `Multiple worktrees have tag '${tag}'`,
        matches.map((path) => ({ value: path, label: branchAt(path), hint: path })),
      );
  openShell(selected);
}

export async function timeCommand(
  specification: string,
  options: ForceOptions & { shell?: boolean },
): Promise<void> {
  const separator = specification.lastIndexOf("@");
  if (separator <= 0) throw new CliError("Format must be <branch>@<YYYY-MM-DD>.");
  const branch = specification.slice(0, separator);
  const date = specification.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CliError("Date must use YYYY-MM-DD format.");
  const repository = requireRepository();
  const commit = optionalGitText(["rev-list", "-n", "1", `--before=${date} 23:59`, branch], repository);
  if (!commit) throw new CliError(`No commit on '${branch}' before ${date}.`);
  mkdirSync(options.dir, { recursive: true });
  const target = join(options.dir, folderFromBranch(`${branch}-${date}`));
  if (existsSync(target) && !options.force) throw new CliError(`Folder already exists: ${target}. Use --force to replace it.`);
  removeTarget(repository, target, Boolean(options.force));
  git(["worktree", "add", "--detach", target, commit], repository);
  ui.success(`Time-machine worktree created at ${target} (${commit.slice(0, 7)}).`);
  if (options.shell !== false) openShell(target);
}

export async function deleteCommand(
  partial: string | undefined,
  options: ForceOptions & { dryRun?: boolean; yes?: boolean },
): Promise<void> {
  const matches = findManagedWorktrees(options.dir, partial ?? "");
  if (!matches.length) throw new CliError(partial === undefined ? "No managed worktrees found." : `No worktree found matching '${partial}'.`);
  if (matches.length === 1 && partial !== undefined) return deleteOne(matches[0]!, options);
  if (partial === undefined) requireTerminal("a worktree");
  else if (!process.stdin.isTTY) throw new CliError(`Multiple worktrees match '${partial}'. Pass a more specific value in non-interactive mode.`);

  const ahead = await aheadCounts(matches);
  const byProject = new Map<string, Worktree[]>();
  for (const match of matches) byProject.set(match.project, [...(byProject.get(match.project) ?? []), match]);
  const chosen = new Set(await chooseMany(
    "Select worktrees to delete (space toggles, enter confirms)",
    Object.fromEntries([...byProject].sort(([a], [b]) => a.localeCompare(b)).map(([project, items]) => [project, items.map((item) => ({
      value: item.path,
      label: item.branch,
      hint: [...deletionWarnings(item, ahead.get(item.path)), item.path].join(", "),
    }))])),
    [],
  ));
  const selected = matches.filter((match) => chosen.has(match.path));
  if (!selected.length) {
    ui.info("Nothing selected; no worktrees deleted.");
    return;
  }
  if (selected.length === 1) return deleteOne(selected[0]!, options);

  heading(options.dryRun ? "Deletion preview" : "Delete worktrees");
  renderTable(["BRANCH", "WARNINGS", "PATH"], selected.map((item) => [
    item.branch,
    color.yellow(deletionWarnings(item, ahead.get(item.path)).join(", ")),
    color.dim(item.path),
  ]));
  if (options.dryRun) return;
  const kept = options.force ? [] : selected.filter((item) => item.dirty);
  const removable = selected.filter((item) => !kept.includes(item));
  for (const item of kept) ui.warning(`Keeping ${item.branch}: uncommitted changes. Pass --force to delete it anyway.`);
  if (!removable.length) return;
  if (!options.yes && !options.force && !(await confirm(`Delete ${removable.length} worktree${removable.length === 1 ? "" : "s"}?`))) {
    throw new CliError("Deletion cancelled.", 130);
  }

  const runner = new SystemAsyncGitRunner();
  const results = await Promise.all(removable.map(async (item) => {
    const common = optionalGitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], item.path) ?? item.path;
    const result = await runner.run({ args: ["worktree", "remove", ...(options.force ? ["--force"] : []), item.path], cwd: common });
    return { item, result };
  }));
  for (const { item, result } of results) {
    if (result.exitCode === 0) ui.success(`Deleted ${item.branch}`);
    else ui.warning(`Could not delete ${item.branch}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  if (results.some(({ result }) => result.exitCode !== 0)) process.exitCode = 1;
}

function deletionWarnings(item: Worktree, ahead: number | undefined): string[] {
  const warnings: string[] = [];
  if (item.dirty) warnings.push("uncommitted changes");
  if (!item.upstream) warnings.push("no upstream");
  else if (ahead) warnings.push(`${ahead} unpushed`);
  return warnings;
}

/** Unpushed commit counts, checked in parallel. */
async function aheadCounts(items: readonly Worktree[]): Promise<Map<string, number>> {
  const runner = new SystemAsyncGitRunner();
  return new Map(await Promise.all(items.filter((item) => item.upstream).map(async (item) => {
    const result = await runner.run({ args: ["rev-list", "--count", "@{u}..HEAD"], cwd: item.path });
    return [item.path, result.exitCode === 0 ? Number(result.stdout.trim()) : 0] as const;
  })));
}

async function deleteOne(selected: Worktree, options: ForceOptions & { dryRun?: boolean; yes?: boolean }): Promise<void> {
  const upstream = optionalGitText(["rev-parse", "--abbrev-ref", "@{u}"], selected.path);
  const ahead = upstream ? Number(optionalGitText(["rev-list", "--count", `${upstream}..HEAD`], selected.path) ?? "0") : undefined;
  const dirty = hasChanges(selected.path);
  const size = formatBytes(directorySize(selected.path));

  heading(options.dryRun ? "Deletion preview" : "Delete worktree");
  console.log(`${color.dim("Path")}     ${selected.path}`);
  console.log(`${color.dim("Branch")}   ${selected.branch}`);
  console.log(`${color.dim("Size")}     ${size}`);
  if (dirty) ui.warning("The worktree has uncommitted changes.");
  if (!upstream) ui.warning("The branch has no upstream.");
  else if (ahead) ui.warning(`The branch has ${ahead} unpushed commit${ahead === 1 ? "" : "s"}.`);
  if (options.dryRun) return;

  if (!options.yes && !options.force) {
    const approved = await confirm(`Delete '${selected.branch}' and its worktree?`);
    if (!approved) throw new CliError("Deletion cancelled.", 130);
  }
  const repository = registeredWorktreePaths(selected.path)[0];
  if (!repository) throw new CliError("Git did not report a primary worktree for this repository.");
  const args = ["worktree", "remove"];
  if (options.force) args.push("--force");
  args.push(selected.path);
  git(args, repository);
  ui.success(`Deleted worktree ${selected.path}`);
}

export async function duCommand(options: DirectoryOptions): Promise<void> {
  const rows = managedWorktreePaths(options.dir)
    .map((path) => ({ path, size: directorySize(path) }))
    .sort((a, b) => b.size - a.size);
  heading("Managed worktree disk usage");
  if (!rows.length) {
    ui.info("No managed worktrees found.");
    return;
  }
  renderTable(["WORKTREE", "SIZE"], rows.map((row) => [basename(row.path), formatBytes(row.size)]));
  const total = rows.reduce((sum, row) => sum + row.size, 0);
  console.log(`\n${color.bold("Total")} ${formatBytes(total)}`);
}

export async function syncCommand(partial: string | undefined, options: DirectoryOptions & { yes?: boolean }): Promise<void> {
  let query = partial;
  if (!query) {
    const repository = requireRepository();
    const current = branchAt(repository);
    if (current === "HEAD") throw new CliError("Detached HEAD cannot be synced without a branch argument.");
    if (!options.yes && !(await confirm(`Sync current branch '${current}'?`))) throw new CliError("Sync cancelled.", 130);
    query = current;
  }
  const selected = await resolveWorktree(options.dir, query);
  const candidates = ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
  const found = candidates.find((ref) => gitOk(["show-ref", "--verify", "--quiet", ref], selected.path));
  if (!found) throw new CliError("No main or master branch exists locally or on origin.");
  const target = found.replace("refs/remotes/", "").replace("refs/heads/", "");
  if (target.startsWith("origin/")) {
    ui.info("Fetching origin…");
    git(["fetch", "origin"], selected.path);
  }

  const dirty = hasChanges(selected.path);
  if (dirty) {
    ui.info("Stashing local changes…");
    git(["stash", "push", "--include-untracked", "-m", `wt sync auto-stash ${new Date().toISOString()}`], selected.path);
  }
  ui.info(`Rebasing ${selected.branch} onto ${target}…`);
  const rebase = git(["rebase", target], selected.path, true);
  if (rebase.status !== 0) {
    git(["rebase", "--abort"], selected.path, true);
    ui.warning("Rebase failed; attempting a merge.");
    git(["merge", target], selected.path);
  }
  if (dirty) {
    const restored = git(["stash", "pop"], selected.path, true);
    if (restored.status !== 0) ui.warning("The sync succeeded, but the stash could not be restored automatically.");
  }
  ui.success(`Synced ${selected.branch} with ${target}.`);
}

export async function pushCommand(options: { message?: string }): Promise<void> {
  const repository = requireRepository();
  if (hasChanges(repository)) {
    const message = options.message ?? (await input("Commit message"));
    git(["add", "-A"], repository);
    git(["commit", "-m", message], repository);
  } else {
    ui.info("Nothing to commit.");
  }
  const branch = branchAt(repository);
  if (branch === "HEAD") throw new CliError("Cannot push a detached HEAD.");
  if (!optionalGitText(["remote", "get-url", "origin"], repository)) {
    const name = basename(repository);
    const owner = optionalGitText(["config", "--get", "github.user"], repository)
      ?? optionalGitText(["config", "--get", "user.name"], repository)
      ?? "USERNAME";
    const suggested = `https://github.com/${owner}/${name}.git`;
    const url = await input("Origin URL", suggested);
    git(["remote", "add", "origin", url || suggested], repository);
  }
  git(["push", "-u", "origin", branch], repository);
  ui.success(`Pushed ${branch} to origin.`);
}

export interface CleanOptions extends DirectoryOptions {
  current?: boolean;
  dryRun?: boolean;
  dangerousAccept?: boolean;
  deleteBranch?: boolean;
  fetch?: boolean;
}

const cleanLabels: Record<CleanCandidate["verdict"]["reason"], string> = {
  merged: "merged",
  "squash-merged": "squash merged",
  pushed: "pushed",
  missing: "folder missing",
  primary: "main checkout",
  bare: "bare repository",
  locked: "locked",
  current: "you are in it",
  dirty: "uncommitted changes",
  unpushed: "unpushed commits",
  error: "check failed",
};

export async function cleanCommand(options: CleanOptions): Promise<void> {
  const currentPath = optionalGitText(["rev-parse", "--show-toplevel"]);
  if (options.current && !currentPath) throw new CliError("Not inside a Git repository.");
  const paths = options.current ? [currentPath!] : managedWorktreePaths(options.dir);
  if (!paths.length) {
    ui.info("No managed worktrees found.");
    return;
  }

  const progress = spinner();
  progress.start(options.fetch === false ? "Checking worktrees…" : "Fetching remotes and checking worktrees…");
  const fetchErrors: string[] = [];
  const candidates = await analyzeCleanup({
    paths,
    ...(options.current ? {} : { within: options.dir }),
    fetch: options.fetch !== false,
    ...(currentPath ? { currentPath } : {}),
    onFetchError: (repository, message) => fetchErrors.push(`${repository}: ${message}`),
  });
  const reported = candidates.filter((c) => !["primary", "bare"].includes(c.verdict.reason));
  const removable = reported.filter((c) => c.verdict.removable);
  progress.stop(`Checked ${reported.length} worktree${reported.length === 1 ? "" : "s"}.`);
  for (const error of fetchErrors) ui.warning(`Fetch failed, using local refs. ${error}`);

  const groups = groupByRepository(reported);
  for (const [name, items] of groups) {
    heading(name);
    renderTable(["", "BRANCH", "STATUS", "PATH"], items.map((c) => [
      c.verdict.removable ? color.green("✓") : color.yellow("•"),
      c.branch ?? color.dim(`detached ${c.worktree.head.slice(0, 7)}`),
      (c.verdict.removable ? color.green : color.yellow)(cleanLabels[c.verdict.reason] + (!c.verdict.removable && c.verdict.detail ? `: ${c.verdict.detail}` : "")),
      color.dim(c.worktree.path),
    ]));
  }
  console.log();
  if (!removable.length) {
    ui.info("Nothing to clean.");
    return;
  }
  if (options.dryRun) {
    ui.info(`${removable.length} worktree${removable.length === 1 ? "" : "s"} can be removed. Dry run: nothing changed.`);
    return;
  }

  let selected = removable;
  if (!options.dangerousAccept) {
    if (!process.stdin.isTTY) throw new CliError("Choosing worktrees needs a terminal. Pass --dangerous-accept to remove every safe one, or --dry-run to preview.");
    const chosen = new Set(await chooseMany(
      "Select worktrees to remove (space toggles, enter confirms)",
      Object.fromEntries([...groupByRepository(removable)].map(([name, items]) => [name, items.map((c) => ({
        value: c.worktree.path,
        label: c.branch ?? `detached ${c.worktree.head.slice(0, 7)}`,
        hint: `${cleanLabels[c.verdict.reason]}, ${c.worktree.path}`,
      }))])),
      removable.map((c) => c.worktree.path),
    ));
    selected = removable.filter((c) => chosen.has(c.worktree.path));
    if (!selected.length) {
      ui.info("Nothing selected; no worktrees removed.");
      return;
    }
  }

  progress.start(`Removing ${selected.length} worktree${selected.length === 1 ? "" : "s"}…`);
  const results = await executeCleanup(selected, { deleteBranch: Boolean(options.deleteBranch) });
  const failed = results.filter((r) => !r.ok || r.error);
  progress.stop(`Removed ${results.filter((r) => r.ok).length} of ${results.length}.`);
  for (const result of results) {
    const label = result.candidate.branch ?? result.candidate.worktree.path;
    if (!result.ok) ui.warning(`Could not remove ${label}: ${result.error}`);
    else if (result.error) ui.warning(`Removed ${label}, ${result.error}`);
    else ui.success(`Removed ${label}${result.branchDeleted ? " and its branch" : ""}`);
  }
  if (failed.length) process.exitCode = 1;
}

function groupByRepository(candidates: readonly CleanCandidate[]): Map<string, CleanCandidate[]> {
  const byRepository = new Map<string, CleanCandidate[]>();
  for (const candidate of candidates) {
    byRepository.set(candidate.repository, [...(byRepository.get(candidate.repository) ?? []), candidate]);
  }
  const nameCounts = new Map<string, number>();
  for (const [, items] of byRepository) nameCounts.set(items[0]!.repositoryName, (nameCounts.get(items[0]!.repositoryName) ?? 0) + 1);
  // Two repositories can share a display name; keep them apart by showing the Git directory.
  return new Map([...byRepository]
    .map(([repository, items]) => {
      const name = items[0]!.repositoryName;
      return [nameCounts.get(name)! > 1 ? `${name} (${repository})` : name, items] as const;
    })
    .sort(([a], [b]) => a.localeCompare(b)));
}
