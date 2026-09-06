import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitWorktreeError } from "./errors.js";
import { WorktreeManager } from "./manager.js";
import type { GitRunRequest, GitRunner } from "./runner.js";

class FakeRunner implements GitRunner {
  calls: GitRunRequest[] = [];
  output = "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0";
  run(request: GitRunRequest) {
    this.calls.push(request);
    return { stdout: request.args[1] === "list" ? this.output : "", stderr: "", exitCode: 0 };
  }
}

describe("WorktreeManager", () => {
  test("lists through the exact NUL porcelain format", () => {
    const runner = new FakeRunner();
    expect(new WorktreeManager({ cwd: "/repo", runner }).list()[0]?.branch).toBe("refs/heads/main");
    expect(runner.calls[0]?.args).toEqual(["worktree", "list", "--porcelain", "-z"]);
  });

  test("removal accepts only an exactly registered path", () => {
    const runner = new FakeRunner();
    const manager = new WorktreeManager({ cwd: "/repo", runner });
    expect(() => manager.remove("/repo-typo", { force: true })).toThrow(GitWorktreeError);
    expect(runner.calls.every((call) => call.args[1] === "list")).toBe(true);
  });

  test("branch lookup never uses partial matching", () => {
    const manager = new WorktreeManager({ cwd: "/repo", runner: new FakeRunner() });
    expect(manager.getByBranch("mai")).toBeUndefined();
    expect(manager.getByBranch("main")?.path).toBe("/repo");
  });

  test("manages the real Git registry lifecycle", () => {
    const root = mkdtempSync(join(tmpdir(), "git-wt-core-"));
    const repository = join(root, "repository");
    const first = join(root, "first");
    const moved = join(root, "moved");
    const git = (args: string[], cwd = repository) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    try {
      git(["init", "-b", "main", repository], root);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      writeFileSync(join(repository, "README.md"), "test\n");
      git(["add", "README.md"]);
      git(["commit", "-m", "initial"]);

      const manager = new WorktreeManager({ cwd: repository });
      manager.add({ path: first, branch: "feature/exact", startPoint: "main" });
      expect(realpathSync(manager.getByBranch("feature/exact")!.path)).toBe(realpathSync(first));
      manager.lock(first, "test lock");
      expect(manager.getByPath(first)).toMatchObject({ locked: true, lockReason: "test lock" });
      manager.unlock(first);
      manager.move(first, moved);
      expect(manager.getByPath(moved)?.branch).toBe("refs/heads/feature/exact");
      manager.remove(moved);
      expect(manager.getByPath(moved)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
