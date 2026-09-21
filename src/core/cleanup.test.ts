import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeCleanup, executeCleanup } from "./cleanup.js";

const roots: string[] = [];

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(cwd: string, file: string, content = `${file}\n`): void {
  writeFileSync(join(cwd, file), content);
  git(["add", file], cwd);
  git(["commit", "-qm", file], cwd);
}

/** A repository with origin, plus one worktree per scenario under `managed`. */
function scenario() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wt-clean-")));
  roots.push(root);
  const origin = join(root, "origin.git");
  const repository = join(root, "repository");
  const managed = join(root, "managed");
  git(["init", "-q", "--bare", "-b", "main", origin], root);
  git(["init", "-q", "-b", "main", repository], root);
  git(["config", "user.name", "WT Test"], repository);
  git(["config", "user.email", "wt@example.com"], repository);
  git(["remote", "add", "origin", origin], repository);
  commit(repository, "base.txt");
  git(["push", "-q", "-u", "origin", "main"], repository);

  const add = (name: string) => {
    const path = join(managed, name);
    git(["worktree", "add", "-q", "-b", name, path, "main"], repository);
    return path;
  };

  const merged = add("merged");
  commit(merged, "merged.txt");
  git(["merge", "-q", "--ff-only", "merged"], repository);

  const squashed = add("squashed");
  commit(squashed, "squash-a.txt");
  commit(squashed, "squash-b.txt");
  git(["merge", "-q", "--squash", "squashed"], repository);
  git(["commit", "-qm", "squash merge"], repository);
  git(["push", "-q", "origin", "main"], repository);

  const pushed = add("pushed");
  commit(pushed, "pushed.txt");
  git(["push", "-q", "-u", "origin", "pushed"], pushed);

  const unpushed = add("unpushed");
  commit(unpushed, "unpushed.txt");

  const dirty = add("dirty");
  writeFileSync(join(dirty, "untracked.txt"), "work in progress\n");

  const locked = add("locked");
  git(["worktree", "lock", locked], repository);

  return { repository, managed, paths: { merged, squashed, pushed, unpushed, dirty, locked } };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("analyzeCleanup", () => {
  test("marks only merged, squash-merged, and pushed clean worktrees as removable", async () => {
    const { repository, managed } = scenario();
    const candidates = await analyzeCleanup({ paths: [repository], within: managed, fetch: false });
    const verdicts = Object.fromEntries(candidates.map((c) => [c.branch, c.verdict.reason]));
    expect(verdicts).toEqual({
      merged: "merged",
      squashed: "squash-merged",
      pushed: "pushed",
      unpushed: "unpushed",
      dirty: "dirty",
      locked: "locked",
    });
  });

  test("never offers the primary checkout or the current worktree", async () => {
    const { repository, paths } = scenario();
    const candidates = await analyzeCleanup({ paths: [repository], currentPath: paths.merged, fetch: false });
    const byPath = new Map(candidates.map((c) => [c.worktree.path, c.verdict]));
    expect(byPath.get(repository)).toEqual({ removable: false, reason: "primary" });
    expect(byPath.get(paths.merged)).toEqual({ removable: false, reason: "current" });
  });

  test("treats a deleted folder as a stale registration to prune", async () => {
    const { repository, managed, paths } = scenario();
    rmSync(paths.unpushed, { recursive: true, force: true });
    const candidates = await analyzeCleanup({ paths: [repository], within: managed, fetch: false });
    expect(candidates.find((c) => c.branch === "unpushed")?.verdict).toEqual({ removable: true, reason: "missing" });
  });
});

describe("executeCleanup", () => {
  test("removes selected worktrees in parallel and optionally their branches", async () => {
    const { repository, managed, paths } = scenario();
    const candidates = await analyzeCleanup({ paths: [repository], within: managed, fetch: false });
    const results = await executeCleanup(candidates, { deleteBranch: true });

    expect(results.map((r) => r.candidate.branch).sort()).toEqual(["merged", "pushed", "squashed"]);
    expect(results.every((r) => r.ok && r.branchDeleted)).toBe(true);
    for (const kept of [paths.unpushed, paths.dirty, paths.locked]) expect(existsSync(kept)).toBe(true);
    for (const removed of [paths.merged, paths.squashed, paths.pushed]) expect(existsSync(removed)).toBe(false);
    expect(git(["branch", "--list", "merged", "squashed", "pushed"], repository)).toBe("");
    expect(git(["branch", "--list", "unpushed"], repository)).toContain("unpushed");
  });
});
