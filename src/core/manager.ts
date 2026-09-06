import { resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { GitWorktreeError } from "./errors.js";
import type { WorktreeRecord } from "./model.js";
import { parseWorktreePorcelain } from "./parser.js";
import { SystemGitRunner, type GitRunResult, type GitRunner } from "./runner.js";

export interface MutationResult {
  before: readonly WorktreeRecord[];
  after: readonly WorktreeRecord[];
}

export interface AddWorktreeOptions {
  path: string;
  branch?: string;
  startPoint?: string;
  detach?: boolean;
  force?: boolean;
  lock?: boolean;
  lockReason?: string;
}

export interface RemoveWorktreeOptions {
  force?: boolean;
}

/** Exact, injectable API over one Git repository's worktree registry. */
export class WorktreeManager {
  readonly cwd: string;
  readonly runner: GitRunner;

  constructor(options: { cwd?: string; runner?: GitRunner } = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.runner = options.runner ?? new SystemGitRunner();
  }

  list(): WorktreeRecord[] {
    return parseWorktreePorcelain(this.git(["worktree", "list", "--porcelain", "-z"]).stdout);
  }

  getByPath(path: string): WorktreeRecord | undefined {
    const target = canonicalPath(this.cwd, path);
    return this.list().find((item) => canonicalPath(this.cwd, item.path) === target);
  }

  getByBranch(branch: string): WorktreeRecord | undefined {
    const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
    return this.list().find((item) => item.branch === ref);
  }

  add(options: AddWorktreeOptions): MutationResult {
    const before = this.list();
    const target = resolve(this.cwd, options.path);
    if (before.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target))) {
      throw new GitWorktreeError(`Worktree is already registered: ${target}`, { code: "ALREADY_REGISTERED" });
    }
    if (options.branch && options.detach) {
      throw new GitWorktreeError("branch and detach cannot be used together", { code: "INVALID_ARGUMENT" });
    }
    if (options.lockReason && !options.lock) {
      throw new GitWorktreeError("lockReason requires lock", { code: "INVALID_ARGUMENT" });
    }

    const args = ["worktree", "add"];
    if (options.force) args.push("--force");
    if (options.detach) args.push("--detach");
    if (options.lock) args.push("--lock");
    if (options.lockReason) args.push("--reason", options.lockReason);
    if (options.branch) args.push("-b", options.branch);
    args.push(target);
    if (options.startPoint) args.push(options.startPoint);
    this.git(args);
    const after = this.list();
    if (!after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target))) {
      throw new GitWorktreeError(`Git completed but did not register ${target}`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }

  remove(path: string, options: RemoveWorktreeOptions = {}): MutationResult {
    const target = this.requireExactPath(path);
    const before = this.list();
    const args = ["worktree", "remove"];
    if (options.force) args.push("--force");
    args.push(target.path);
    this.git(args);
    const after = this.list();
    if (after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target.path))) {
      throw new GitWorktreeError(`Git completed but ${target.path} remains registered`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }

  move(path: string, destination: string, force = false): MutationResult {
    const target = this.requireExactPath(path);
    const before = this.list();
    const args = ["worktree", "move"];
    if (force) args.push("--force");
    const nextPath = resolve(this.cwd, destination);
    args.push(target.path, nextPath);
    this.git(args);
    const after = this.list();
    if (!after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, nextPath))) {
      throw new GitWorktreeError(`Git completed but did not register ${nextPath}`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }

  lock(path: string, reason?: string): MutationResult {
    return this.simpleMutation(path, ["lock", ...(reason ? ["--reason", reason] : [])], true);
  }

  unlock(path: string): MutationResult {
    return this.simpleMutation(path, ["unlock"], false);
  }

  repair(paths: readonly string[] = []): MutationResult {
    const before = this.list();
    this.git(["worktree", "repair", ...paths.map((path) => resolve(this.cwd, path))]);
    return { before, after: this.list() };
  }

  prune(options: { dryRun?: boolean; verbose?: boolean; expire?: string } = {}): MutationResult {
    const before = this.list();
    const args = ["worktree", "prune"];
    if (options.dryRun) args.push("--dry-run");
    if (options.verbose) args.push("--verbose");
    if (options.expire) args.push("--expire", options.expire);
    this.git(args);
    return { before, after: this.list() };
  }

  private simpleMutation(path: string, operation: string[], expectedLocked: boolean): MutationResult {
    const target = this.requireExactPath(path);
    const before = this.list();
    this.git(["worktree", ...operation, target.path]);
    const after = this.list();
    const updated = after.find((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target.path));
    if (!updated || updated.locked !== expectedLocked) {
      throw new GitWorktreeError("Git completed but the registry state did not match", { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }

  private requireExactPath(path: string): WorktreeRecord {
    const target = this.getByPath(path);
    if (!target) {
      throw new GitWorktreeError(`No worktree is registered at ${resolve(this.cwd, path)}`, { code: "NOT_REGISTERED" });
    }
    return target;
  }

  private git(args: string[]): GitRunResult {
    const result = this.runner.run({ args, cwd: this.cwd });
    if (result.exitCode !== 0) {
      throw new GitWorktreeError(result.stderr.trim() || result.stdout.trim() || `Git exited with ${result.exitCode}`, {
        code: "GIT_FAILED",
        command: args,
        exitCode: result.exitCode,
      });
    }
    return result;
  }
}

function canonicalPath(cwd: string, path: string): string {
  const absolute = resolve(cwd, path);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}
