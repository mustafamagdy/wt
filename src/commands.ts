import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { analyzeCleanup, executeCleanup, type CleanCandidate } from "./core/cleanup.js";
import { GitWorktreeError } from "./core/errors.js";
import { branchAt, git, gitRaw, optionalGitText, requireRepository } from "./core/git.js";
import {
  addTag,
  checkoutWorktree,
  commitAndPush,
  createWorktree,
  diskUsage,
  hasUncommittedChanges,
  inspectWorktree,
  originUrl,
  removeWorktree,
  removeWorktrees,
  syncWorktree,
  tagCounts,
  timeWorktree,
  unpushedCounts,
  worktreesWithTag,
} from "./core/operations.js";
import { parseWorktreePorcelain } from "./core/parser.js";
import { findManagedWorktrees, formatBytes, listWorktrees, managedWorktreePaths, type Worktree } from "./core/worktrees.js";
import { CliError } from "./errors.js";
import { chooseMany, color, confirm, heading, input, renderTable, search, spinner, ui } from "./ui.js";

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

/** Add a CLI-specific next step to core errors with the given codes. */
function withHints<T>(action: () => T, hints: Record<string, string>): T {
  try {
    return action();
  } catch (error) {
    const hint = error instanceof GitWorktreeError ? hints[error.code] : undefined;
    if (hint) throw new CliError(`${(error as Error).message} ${hint}`);
    throw error;
  }
}

const replaceHint = { TARGET_EXISTS: "Use --force to replace it." };

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
  const created = withHints(() => createWorktree({
    root: options.dir,
    branch,
    ...(base ? { base } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.copy ? { copy: options.copy.split(",") } : {}),
  }), { ...replaceHint, BRANCH_EXISTS: `Use 'wt checkout ${branch}'.` });
  for (const copied of created.copied) {
    if (!copied.count) ui.warning(`No files match '${copied.pattern}'; skipped.`);
    else ui.success(`Copied ${copied.count} item${copied.count === 1 ? "" : "s"} matching '${copied.pattern}'.`);
  }
  ui.success(`Worktree ready at ${created.path}`);
  if (options.shell !== false) openShell(created.path);
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
  const result = withHints(
    () => checkoutWorktree({ root: options.dir, branch, ...(options.force ? { force: true } : {}) }),
    replaceHint,
  );
  ui.success(result.reused ? `Using existing worktree at ${result.path}` : `Worktree ready at ${result.path}`);
  if (options.shell !== false) openShell(result.path);
}

export async function switchCommand(partial: string | undefined, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  ui.info(`Opening ${selected.branch}`);
  openShell(selected.path);
}

export async function tagCommand(partial: string | undefined, tagArgument: string | undefined, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  let tag = tagArgument;
  if (tag === undefined) {
    requireTerminal("a tag");
    const known = [...tagCounts(options.dir).keys()];
    tag = await input(`Tag for '${selected.branch}'`, known.length ? `existing: ${known.join(", ")}` : undefined);
  }
  addTag(selected.path, tag);
  ui.success(`Tagged '${selected.branch}' as '${tag}'.`);
}

export async function switchGroupCommand(tagArgument: string | undefined, options: DirectoryOptions): Promise<void> {
  let tag = tagArgument;
  if (tag === undefined) {
    requireTerminal("a tag");
    const counts = tagCounts(options.dir);
    if (!counts.size) throw new CliError("No worktree has a tag yet. Add one with 'wt tag'.");
    tag = await search("Pick a tag", [...counts].map(([name, count]) => ({
      value: name,
      label: name,
      hint: `${count} worktree${count === 1 ? "" : "s"}`,
    })));
  }
  const matches = worktreesWithTag(options.dir, tag);
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
  const result = withHints(() => timeWorktree({
    root: options.dir,
    branch: specification.slice(0, separator),
    date: specification.slice(separator + 1),
    ...(options.force ? { force: true } : {}),
  }), replaceHint);
  ui.success(`Time-machine worktree created at ${result.path} (${result.commit.slice(0, 7)}).`);
  if (options.shell !== false) openShell(result.path);
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

  const ahead = await unpushedCounts(matches);
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

  const results = await removeWorktrees(removable.map((item) => item.path), { force: Boolean(options.force) });
  for (const result of results) {
    const branch = removable.find((item) => item.path === result.path)!.branch;
    if (result.ok) ui.success(`Deleted ${branch}`);
    else ui.warning(`Could not delete ${branch}: ${result.error}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

function deletionWarnings(item: Worktree, ahead: number | undefined): string[] {
  const warnings: string[] = [];
  if (item.dirty) warnings.push("uncommitted changes");
  if (!item.upstream) warnings.push("no upstream");
  else if (ahead) warnings.push(`${ahead} unpushed`);
  return warnings;
}

async function deleteOne(selected: Worktree, options: ForceOptions & { dryRun?: boolean; yes?: boolean }): Promise<void> {
  const status = inspectWorktree(selected.path, { size: true });

  heading(options.dryRun ? "Deletion preview" : "Delete worktree");
  console.log(`${color.dim("Path")}     ${selected.path}`);
  console.log(`${color.dim("Branch")}   ${selected.branch}`);
  console.log(`${color.dim("Size")}     ${formatBytes(status.size ?? 0)}`);
  if (status.dirty) ui.warning("The worktree has uncommitted changes.");
  if (!status.upstream) ui.warning("The branch has no upstream.");
  else if (status.ahead) ui.warning(`The branch has ${status.ahead} unpushed commit${status.ahead === 1 ? "" : "s"}.`);
  if (options.dryRun) return;

  if (!options.yes && !options.force) {
    const approved = await confirm(`Delete '${selected.branch}' and its worktree?`);
    if (!approved) throw new CliError("Deletion cancelled.", 130);
  }
  removeWorktree(selected.path, { force: Boolean(options.force) });
  ui.success(`Deleted worktree ${selected.path}`);
}

export async function duCommand(options: DirectoryOptions): Promise<void> {
  const rows = diskUsage(options.dir);
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
  const result = syncWorktree(selected.path, {
    onStep: (step, detail) => {
      if (step === "fetch") ui.info("Fetching origin…");
      else if (step === "stash") ui.info("Stashing local changes…");
      else if (step === "rebase") ui.info(`Rebasing ${detail}…`);
      else ui.warning("Rebase failed; attempting a merge.");
    },
  });
  if (!result.stashRestored) ui.warning("The sync succeeded, but the stash could not be restored automatically.");
  ui.success(`Synced ${result.branch} with ${result.target}.`);
}

export async function pushCommand(options: { message?: string }): Promise<void> {
  const repository = requireRepository();
  let message = options.message;
  if (hasUncommittedChanges(repository)) message ??= await input("Commit message");
  else ui.info("Nothing to commit.");
  let origin: string | undefined;
  if (!originUrl(repository) && branchAt(repository) !== "HEAD") {
    const owner = optionalGitText(["config", "--get", "github.user"], repository)
      ?? optionalGitText(["config", "--get", "user.name"], repository)
      ?? "USERNAME";
    const suggested = `https://github.com/${owner}/${basename(repository)}.git`;
    origin = (await input("Origin URL", suggested)) || suggested;
  }
  const result = commitAndPush({ cwd: repository, ...(message ? { message } : {}), ...(origin ? { originUrl: origin } : {}) });
  ui.success(`Pushed ${result.branch} to origin.`);
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
