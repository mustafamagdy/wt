import { spawnSync } from "node:child_process";
import { GitWorktreeError } from "./errors.js";

export interface GitRunRequest {
  args: readonly string[];
  cwd: string;
  stdin?: "ignore" | "inherit";
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunner {
  run(request: GitRunRequest): GitRunResult;
}

export class SystemGitRunner implements GitRunner {
  run(request: GitRunRequest): GitRunResult {
    const result = spawnSync("git", request.args, {
      cwd: request.cwd,
      encoding: "utf8",
      stdio: [request.stdin ?? "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (result.error) {
      throw new GitWorktreeError(`Unable to run Git: ${result.error.message}`, {
        code: "GIT_UNAVAILABLE",
        command: request.args,
        cause: result.error,
      });
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
    };
  }
}
