import { spawnSync } from "node:child_process";
import { GitWorktreeError } from "./errors.js";

export interface RunOptions {
  cwd?: string;
  allowFailure?: boolean;
  stdin?: "inherit" | "ignore";
}

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

export function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.error) {
    throw new GitWorktreeError(`Unable to run ${command}: ${result.error.message}`, { code: "COMMAND_UNAVAILABLE", command: args, cause: result.error });
  }

  const status = result.status ?? 1;
  const output = {
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
    status,
  };

  if (status !== 0 && !options.allowFailure) {
    throw new GitWorktreeError(output.stderr || output.stdout || `${command} exited with status ${status}`, { code: command === "git" ? "GIT_FAILED" : "COMMAND_FAILED", command: args, exitCode: status });
  }
  return output;
}

export function git(args: string[], cwd?: string, allowFailure = false): RunResult {
  return run("git", args, { ...(cwd ? { cwd } : {}), allowFailure });
}

/** Raw Git output for machine formats where trailing NUL/newlines are data. */
export function gitRaw(args: string[], cwd?: string, allowFailure = false): RunResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw new GitWorktreeError(`Unable to run git: ${result.error.message}`, { code: "GIT_UNAVAILABLE", command: args, cause: result.error });
  const output = { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
  if (output.status !== 0 && !allowFailure) throw new GitWorktreeError(output.stderr.trimEnd() || output.stdout.trimEnd() || `git exited with status ${output.status}`, { code: "GIT_FAILED", command: args, exitCode: output.status });
  return output;
}

export function gitOk(args: string[], cwd?: string): boolean {
  return git(args, cwd, true).status === 0;
}

export function gitText(args: string[], cwd?: string): string {
  return git(args, cwd).stdout;
}

export function optionalGitText(args: string[], cwd?: string): string | undefined {
  const result = git(args, cwd, true);
  return result.status === 0 && result.stdout ? result.stdout : undefined;
}

export function requireRepository(cwd = process.cwd()): string {
  const root = optionalGitText(["rev-parse", "--show-toplevel"], cwd);
  if (!root) throw new GitWorktreeError("Not inside a Git repository.", { code: "NOT_A_REPOSITORY" });
  return root;
}

export function branchAt(cwd: string): string {
  return optionalGitText(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "HEAD";
}

export function hasChanges(cwd: string): boolean {
  return gitText(["status", "--porcelain"], cwd).length > 0;
}
