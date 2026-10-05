import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseWorktreePorcelain } from "./parser.js";
import { branchAt, git, gitOk, gitRaw, optionalGitText, requireRepository } from "./git.js";

export interface Worktree {
  path: string;
  branch: string;
  head?: string;
  detached: boolean;
  prunable: boolean;
  project: string;
  upstream?: string;
  dirty: boolean;
}

export function registeredWorktreePaths(cwd = process.cwd()): string[] {
  requireRepository(cwd);
  const output = gitRaw(["worktree", "list", "--porcelain", "-z"], cwd).stdout;
  return parseWorktreePorcelain(output).map((item) => item.path);
}

export function managedWorktreePaths(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`)
    .filter((path) => existsSync(`${path}/.git`));
}

export function repositoryName(cwd: string): string {
  const origin = optionalGitText(["remote", "get-url", "origin"], cwd);
  if (origin) return basename(origin.replace(/\.git$/, ""));
  const common = optionalGitText(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return common ? basename(dirname(common)) : basename(requireRepository(cwd));
}

export function describeWorktree(path: string, projectOverride?: string): Worktree | undefined {
  if (!existsSync(path) || !existsSync(`${path}/.git`)) return undefined;
  const branch = branchAt(path);
  const upstream = optionalGitText(["rev-parse", "--abbrev-ref", "@{u}"], path);
  return {
    path,
    branch,
    detached: branch === "HEAD",
    prunable: false,
    project: projectOverride ?? repositoryName(path),
    ...(upstream ? { upstream } : {}),
    dirty: git(["status", "--porcelain"], path).stdout.length > 0,
  };
}

export function listWorktrees(options: { root: string; current: boolean; pattern?: string; cwd?: string }): Worktree[] {
  const cwd = options.cwd ?? process.cwd();
  const project = options.current ? repositoryName(cwd) : undefined;
  const paths = options.current ? registeredWorktreePaths(cwd) : managedWorktreePaths(options.root);
  const pattern = options.pattern?.toLowerCase();
  return paths
    .map((path) => describeWorktree(path, project))
    .filter((item): item is Worktree => Boolean(item))
    .filter((item) => {
      if (!pattern) return true;
      return [item.branch, item.project, item.path].some((value) => value.toLowerCase().includes(pattern));
    });
}

export function findManagedWorktrees(root: string, partial: string): Worktree[] {
  const needle = partial.toLowerCase();
  return managedWorktreePaths(root)
    .map((path) => describeWorktree(path))
    .filter((item): item is Worktree => Boolean(item))
    .filter((item) => item.branch.toLowerCase().includes(needle));
}

export function branchExists(branch: string, cwd: string): { local: boolean; remote: boolean } {
  return {
    local: gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd),
    remote: gitOk(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], cwd),
  };
}

export function directorySize(path: string): number {
  let total = 0;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    let stat;
    try {
      stat = lstatSync(current, { bigint: false });
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      try {
        for (const entry of readdirSync(current)) pending.push(`${current}/${entry}`);
      } catch {
        // Ignore unreadable entries while reporting best-effort usage.
      }
    } else {
      total += stat.size;
    }
  }
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}
