// src/core/errors.ts
class GitWorktreeError extends Error {
  code;
  command;
  exitCode;
  constructor(message, options) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitWorktreeError";
    this.code = options.code;
    this.command = options.command;
    this.exitCode = options.exitCode;
  }
}
// src/core/manager.ts
import { resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";

// src/core/parser.ts
class WorktreePorcelainParseError extends Error {
  recordIndex;
  field;
  constructor(message, recordIndex, field) {
    super(`Invalid git worktree porcelain record ${recordIndex}${field ? ` (${field})` : ""}: ${message}`);
    this.name = "WorktreePorcelainParseError";
    this.recordIndex = recordIndex;
    this.field = field;
  }
}
function parseWorktreePorcelain(output) {
  if (output.length === 0)
    return [];
  const records = output.split("\x00\x00");
  if (records.at(-1) === "")
    records.pop();
  return records.map((record, index) => parseRecord(record, index));
}
var parseWorktreeListPorcelain = parseWorktreePorcelain;
function parseRecord(record, recordIndex) {
  const fields = record.split("\x00");
  if (fields.at(-1) === "")
    fields.pop();
  if (fields.length === 0 || fields[0] === "") {
    throw new WorktreePorcelainParseError("record is empty", recordIndex);
  }
  const pathField = consumeRequired(fields, "worktree ", recordIndex, "worktree");
  const path = pathField.slice("worktree ".length);
  if (path.length === 0)
    throw new WorktreePorcelainParseError("path is empty", recordIndex, "worktree");
  const headField = consumeRequired(fields, "HEAD ", recordIndex, "HEAD");
  const head = headField.slice("HEAD ".length);
  if (head.length === 0 || /\s/.test(head)) {
    throw new WorktreePorcelainParseError("object ID is empty or contains whitespace", recordIndex, "HEAD");
  }
  const result = {
    path,
    head,
    detached: false,
    bare: false,
    locked: false,
    prunable: false
  };
  for (const field of fields) {
    if (field === "")
      continue;
    if (field.startsWith("branch ")) {
      if (result.branch !== undefined || result.detached)
        duplicate(field, recordIndex);
      const branch = field.slice("branch ".length);
      if (!branch)
        throw new WorktreePorcelainParseError("branch ref is empty", recordIndex, "branch");
      result.branch = branch;
    } else if (field === "detached") {
      if (result.detached || result.branch !== undefined)
        duplicate(field, recordIndex);
      result.detached = true;
    } else if (field === "bare") {
      if (result.bare)
        duplicate(field, recordIndex);
      result.bare = true;
    } else if (field === "locked" || field.startsWith("locked ")) {
      if (result.locked)
        duplicate(field, recordIndex);
      result.locked = true;
      const reason = field.length === "locked".length ? undefined : field.slice("locked".length + 1);
      if (reason)
        result.lockReason = reason;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      if (result.prunable)
        duplicate(field, recordIndex);
      result.prunable = true;
      const reason = field.length === "prunable".length ? undefined : field.slice("prunable".length + 1);
      if (reason)
        result.pruneReason = reason;
    } else {
      throw new WorktreePorcelainParseError(`unknown field ${JSON.stringify(field)}`, recordIndex);
    }
  }
  return result;
}
function consumeRequired(fields, prefix, recordIndex, name) {
  const field = fields.shift();
  if (field === undefined || !field.startsWith(prefix)) {
    throw new WorktreePorcelainParseError(`expected ${name} field`, recordIndex, name);
  }
  return field;
}
function duplicate(field, recordIndex) {
  throw new WorktreePorcelainParseError(`duplicate field ${JSON.stringify(field)}`, recordIndex);
}

// src/core/runner.ts
import { spawnSync } from "node:child_process";
class SystemGitRunner {
  run(request) {
    const result = spawnSync("git", request.args, {
      cwd: request.cwd,
      encoding: "utf8",
      stdio: [request.stdin ?? "ignore", "pipe", "pipe"],
      windowsHide: true
    });
    if (result.error) {
      throw new GitWorktreeError(`Unable to run Git: ${result.error.message}`, {
        code: "GIT_UNAVAILABLE",
        command: request.args,
        cause: result.error
      });
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1
    };
  }
}

// src/core/manager.ts
class WorktreeManager {
  cwd;
  runner;
  constructor(options = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.runner = options.runner ?? new SystemGitRunner;
  }
  list() {
    return parseWorktreePorcelain(this.git(["worktree", "list", "--porcelain", "-z"]).stdout);
  }
  getByPath(path) {
    const target = canonicalPath(this.cwd, path);
    return this.list().find((item) => canonicalPath(this.cwd, item.path) === target);
  }
  getByBranch(branch) {
    const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
    return this.list().find((item) => item.branch === ref);
  }
  add(options) {
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
    if (options.force)
      args.push("--force");
    if (options.detach)
      args.push("--detach");
    if (options.lock)
      args.push("--lock");
    if (options.lockReason)
      args.push("--reason", options.lockReason);
    if (options.branch)
      args.push("-b", options.branch);
    args.push(target);
    if (options.startPoint)
      args.push(options.startPoint);
    this.git(args);
    const after = this.list();
    if (!after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target))) {
      throw new GitWorktreeError(`Git completed but did not register ${target}`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }
  remove(path, options = {}) {
    const target = this.requireExactPath(path);
    const before = this.list();
    const args = ["worktree", "remove"];
    if (options.force)
      args.push("--force");
    args.push(target.path);
    this.git(args);
    const after = this.list();
    if (after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, target.path))) {
      throw new GitWorktreeError(`Git completed but ${target.path} remains registered`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }
  move(path, destination, force = false) {
    const target = this.requireExactPath(path);
    const before = this.list();
    const args = ["worktree", "move"];
    if (force)
      args.push("--force");
    const nextPath = resolve(this.cwd, destination);
    args.push(target.path, nextPath);
    this.git(args);
    const after = this.list();
    if (!after.some((item) => canonicalPath(this.cwd, item.path) === canonicalPath(this.cwd, nextPath))) {
      throw new GitWorktreeError(`Git completed but did not register ${nextPath}`, { code: "POSTCONDITION_FAILED" });
    }
    return { before, after };
  }
  lock(path, reason) {
    return this.simpleMutation(path, ["lock", ...reason ? ["--reason", reason] : []], true);
  }
  unlock(path) {
    return this.simpleMutation(path, ["unlock"], false);
  }
  repair(paths = []) {
    const before = this.list();
    this.git(["worktree", "repair", ...paths.map((path) => resolve(this.cwd, path))]);
    return { before, after: this.list() };
  }
  prune(options = {}) {
    const before = this.list();
    const args = ["worktree", "prune"];
    if (options.dryRun)
      args.push("--dry-run");
    if (options.verbose)
      args.push("--verbose");
    if (options.expire)
      args.push("--expire", options.expire);
    this.git(args);
    return { before, after: this.list() };
  }
  simpleMutation(path, operation, expectedLocked) {
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
  requireExactPath(path) {
    const target = this.getByPath(path);
    if (!target) {
      throw new GitWorktreeError(`No worktree is registered at ${resolve(this.cwd, path)}`, { code: "NOT_REGISTERED" });
    }
    return target;
  }
  git(args) {
    const result = this.runner.run({ args, cwd: this.cwd });
    if (result.exitCode !== 0) {
      throw new GitWorktreeError(result.stderr.trim() || result.stdout.trim() || `Git exited with ${result.exitCode}`, {
        code: "GIT_FAILED",
        command: args,
        exitCode: result.exitCode
      });
    }
    return result;
  }
}
function canonicalPath(cwd, path) {
  const absolute = resolve(cwd, path);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}
export {
  parseWorktreePorcelain,
  parseWorktreeListPorcelain,
  WorktreePorcelainParseError,
  WorktreeManager,
  SystemGitRunner,
  GitWorktreeError
};
