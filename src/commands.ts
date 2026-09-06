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
import { folderFromBranch } from "./config.js";
import { CliError } from "./errors.js";
import { branchAt, git, gitOk, hasChanges, optionalGitText, requireRepository } from "./git.js";
import { choose, color, confirm, heading, input, renderTable, ui } from "./ui.js";
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

async function resolveWorktree(root: string, partial: string): Promise<Worktree> {
  const matches = findManagedWorktrees(root, partial);
  if (!matches.length) throw new CliError(`No worktree found matching '${partial}'.`);
  if (matches.length === 1) return matches[0]!;
  const selected = await choose(
    `Multiple worktrees match '${partial}'`,
    matches.map((match) => ({ value: match.path, label: match.branch, hint: match.path })),
  );
  return matches.find((match) => match.path === selected)!;
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
  branch: string,
  base: string | undefined,
  options: ForceOptions & { copy?: string; shell?: boolean },
): Promise<void> {
  const repository = requireRepository();
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

export async function checkoutCommand(branch: string, options: ForceOptions & { shell?: boolean }): Promise<void> {
  const repository = requireRepository();
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

export async function switchCommand(partial: string, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  ui.info(`Opening ${selected.branch}`);
  openShell(selected.path);
}

export async function tagCommand(partial: string, tag: string, options: DirectoryOptions): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
  const tagFile = join(selected.path, ".wt-tags");
  const tags = existsSync(tagFile)
    ? readFileSync(tagFile, "utf8").split("\n").map((value) => value.trim()).filter(Boolean)
    : [];
  if (!tags.includes(tag)) tags.push(tag);
  writeFileSync(tagFile, `${[...new Set(tags)].sort().join("\n")}\n`);
  ui.success(`Tagged '${selected.branch}' as '${tag}'.`);
}

export async function switchGroupCommand(tag: string, options: DirectoryOptions): Promise<void> {
  const matches = managedWorktreePaths(options.dir).filter((path) => {
    const file = join(path, ".wt-tags");
    return existsSync(file) && readFileSync(file, "utf8").split(/\s+/).includes(tag);
  });
  if (!matches.length) throw new CliError(`No worktree tagged '${tag}'.`);
  const selected = matches.length === 1
    ? matches[0]!
    : await choose(
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
  partial: string,
  options: ForceOptions & { dryRun?: boolean; yes?: boolean },
): Promise<void> {
  const selected = await resolveWorktree(options.dir, partial);
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
