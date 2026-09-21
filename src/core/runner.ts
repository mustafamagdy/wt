import { spawn, spawnSync } from "node:child_process";
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

/** Non-blocking runner, so independent Git calls can run concurrently. */
export interface AsyncGitRunner {
  run(request: GitRunRequest): Promise<GitRunResult>;
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

export class SystemAsyncGitRunner implements AsyncGitRunner {
  run(request: GitRunRequest): Promise<GitRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", request.args, {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        // No stdin is attached, so a credential prompt would hang forever.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => {
        reject(new GitWorktreeError(`Unable to run Git: ${error.message}`, {
          code: "GIT_UNAVAILABLE",
          command: request.args,
          cause: error,
        }));
      });
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    });
  }
}
