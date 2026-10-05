import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorktreeError } from "./errors.js";
import { git } from "./git.js";
import {
  addTag,
  checkoutWorktree,
  commitAndPush,
  createWorktree,
  inspectWorktree,
  removeWorktree,
  selectWorktrees,
  syncWorktree,
  tagCounts,
  timeWorktree,
} from "./operations.js";

const fixtures: string[] = [];

function fixture(): { repository: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "wt-ops-test-"));
  fixtures.push(base);
  const repository = join(base, "repository");
  git(["init", "-q", "-b", "main", repository]);
  git(["config", "user.name", "WT Test"], repository);
  git(["config", "user.email", "wt@example.com"], repository);
  writeFileSync(join(repository, "tracked.txt"), "fixture\n");
  git(["add", "tracked.txt"], repository);
  git(["commit", "-qm", "initial"], repository);
  return { repository, root: join(base, "managed") };
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof GitWorktreeError) return error.code;
    throw error;
  }
  return undefined;
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("core operations", () => {
  test("creates a worktree, copies files, and reports conflicts with codes", () => {
    const { repository, root } = fixture();
    writeFileSync(join(repository, ".env"), "SECRET=1\n");
    const created = createWorktree({ cwd: repository, root, branch: "feature/one", copy: [".env", "missing*"] });
    expect(created.path).toBe(join(root, "feature-one"));
    expect(created.copied).toEqual([{ pattern: ".env", count: 1 }, { pattern: "missing*", count: 0 }]);
    expect(readFileSync(join(created.path, ".env"), "utf8")).toBe("SECRET=1\n");

    expect(errorCode(() => createWorktree({ cwd: repository, root, branch: "feature/one" }))).toBe("BRANCH_EXISTS");
    expect(errorCode(() => createWorktree({ cwd: repository, root, branch: "other", base: "nope" }))).toBe("BRANCH_NOT_FOUND");
  });

  test("checkout reuses an existing worktree for the same branch", () => {
    const { repository, root } = fixture();
    git(["branch", "feature/two"], repository);
    const first = checkoutWorktree({ cwd: repository, root, branch: "feature/two" });
    const second = checkoutWorktree({ cwd: repository, root, branch: "feature/two" });
    expect(first.reused).toBe(false);
    expect(second).toEqual({ ...first, reused: true });
    expect(errorCode(() => checkoutWorktree({ cwd: repository, root, branch: "ghost" }))).toBe("BRANCH_NOT_FOUND");
  });

  test("selects exact matches before partial ones", () => {
    const { repository, root } = fixture();
    createWorktree({ cwd: repository, root, branch: "api" });
    createWorktree({ cwd: repository, root, branch: "api-v2" });
    expect(selectWorktrees(root, "api").map((item) => item.branch)).toEqual(["api"]);
    expect(selectWorktrees(root, "API").map((item) => item.branch).sort()).toEqual(["api", "api-v2"]);
    expect(selectWorktrees(root, "api-v2")).toHaveLength(1);
    expect(selectWorktrees(root, "zzz")).toEqual([]);
  });

  test("inspects, tags, and refuses to remove dirty worktrees without force", () => {
    const { repository, root } = fixture();
    const { path } = createWorktree({ cwd: repository, root, branch: "feature/three" });
    expect(inspectWorktree(path)).toEqual({ path, branch: "feature/three", dirty: false, changes: 0 });

    expect(addTag(path, "ui")).toEqual({ tags: ["ui"], added: true });
    expect(addTag(path, "ui")).toEqual({ tags: ["ui"], added: false });
    expect(tagCounts(root)).toEqual(new Map([["ui", 1]]));
    expect(errorCode(() => addTag(path, "two words"))).toBe("INVALID_ARGUMENT");

    expect(inspectWorktree(path)).toMatchObject({ dirty: true, changes: 1 });
    expect(errorCode(() => removeWorktree(path))).toBe("GIT_FAILED");
    removeWorktree(path, { force: true });
    expect(existsSync(path)).toBe(false);
  });

  test("syncs onto main and restores local changes", () => {
    const { repository, root } = fixture();
    const { path } = createWorktree({ cwd: repository, root, branch: "feature/sync" });
    writeFileSync(join(repository, "upstream.txt"), "new\n");
    git(["add", "upstream.txt"], repository);
    git(["commit", "-qm", "upstream"], repository);
    writeFileSync(join(path, "local.txt"), "wip\n");

    const steps: string[] = [];
    const result = syncWorktree(path, { onStep: (step) => steps.push(step) });
    expect(result).toEqual({ path, branch: "feature/sync", target: "main", fetched: false, updated: true, method: "rebase", stashed: true, stashRestored: true });
    expect(steps).toEqual(["stash", "rebase"]);
    expect(existsSync(join(path, "upstream.txt"))).toBe(true);
    expect(existsSync(join(path, "local.txt"))).toBe(true);
    expect(syncWorktree(path)).toMatchObject({ updated: false, stashed: true });
  });

  test("reports sync conflicts with a code and keeps local changes stashed", () => {
    const { repository, root } = fixture();
    const { path } = createWorktree({ cwd: repository, root, branch: "feature/conflict" });
    writeFileSync(join(path, "tracked.txt"), "mine\n");
    git(["commit", "-qam", "mine"], path);
    writeFileSync(join(repository, "tracked.txt"), "theirs\n");
    git(["commit", "-qam", "theirs"], repository);
    writeFileSync(join(path, "wip.txt"), "wip\n");
    expect(errorCode(() => syncWorktree(path))).toBe("SYNC_CONFLICT");
    expect(git(["stash", "list"], path).stdout).toContain("wt sync auto-stash");
  });

  test("selects worktrees registered to a repository outside the managed directory", () => {
    const { repository, root } = fixture();
    const outside = join(repository, "..", "outside");
    git(["worktree", "add", "-q", "-b", "elsewhere", outside], repository);
    expect(selectWorktrees(root, "elsewhere")).toEqual([]);
    expect(selectWorktrees(root, "elsewhere", { repository }).map((item) => item.branch)).toEqual(["elsewhere"]);
    expect(selectWorktrees(root, "main", { repository }).map((item) => item.branch)).toEqual(["main"]);
  });

  test("validates time-machine dates and push prerequisites", () => {
    const { repository, root } = fixture();
    expect(errorCode(() => timeWorktree({ cwd: repository, root, branch: "main", date: "2020/01/01" }))).toBe("INVALID_ARGUMENT");
    expect(errorCode(() => timeWorktree({ cwd: repository, root, branch: "main", date: "1990-01-01" }))).toBe("NO_COMMIT");

    writeFileSync(join(repository, "change.txt"), "x\n");
    expect(errorCode(() => commitAndPush({ cwd: repository }))).toBe("MESSAGE_REQUIRED");
    expect(errorCode(() => commitAndPush({ cwd: repository, message: "change" }))).toBe("NO_ORIGIN");
  });
});
