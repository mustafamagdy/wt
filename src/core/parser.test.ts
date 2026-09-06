import { describe, expect, test } from "bun:test";
import { parseWorktreePorcelain, WorktreePorcelainParseError } from "./parser.js";

describe("parseWorktreePorcelain", () => {
  test("parses attached, detached, bare, locked, and prunable entries", () => {
    const input = [
      "worktree /repo/main\0HEAD abc123\0branch refs/heads/main\0\0",
      "worktree /repo/locked\0HEAD def456\0branch refs/heads/locked\0locked held by CI\0\0",
      "worktree /repo/detached\0HEAD 789abc\0detached\0prunable missing directory\0\0",
      "worktree /repo.git\0HEAD 012345\0bare\0\0",
    ].join("");

    expect(parseWorktreePorcelain(input)).toEqual([
      { path: "/repo/main", head: "abc123", branch: "refs/heads/main", detached: false, bare: false, locked: false, prunable: false },
      { path: "/repo/locked", head: "def456", branch: "refs/heads/locked", detached: false, bare: false, locked: true, lockReason: "held by CI", prunable: false },
      { path: "/repo/detached", head: "789abc", detached: true, bare: false, locked: false, prunable: true, pruneReason: "missing directory" },
      { path: "/repo.git", head: "012345", detached: false, bare: true, locked: false, prunable: false },
    ]);
  });

  test("preserves tabs, newlines, and Unicode in paths and reasons", () => {
    const path = "/tmp/one\ttwo\nمرحبا/🌳";
    const reason = "paused\tby\noperator";
    expect(parseWorktreePorcelain(`worktree ${path}\0HEAD abc\0branch refs/heads/x\0locked ${reason}\0\0`)[0]).toEqual({
      path,
      head: "abc",
      branch: "refs/heads/x",
      detached: false,
      bare: false,
      locked: true,
      lockReason: reason,
      prunable: false,
    });
  });

  test("accepts output without the final NUL separator", () => {
    expect(parseWorktreePorcelain("worktree /repo\0HEAD abc\0detached")).toEqual([
      { path: "/repo", head: "abc", detached: true, bare: false, locked: false, prunable: false },
    ]);
  });

  test("reports malformed records with record and field context", () => {
    expect(() => parseWorktreePorcelain("worktree /repo\0branch refs/heads/main\0\0")).toThrow(WorktreePorcelainParseError);
    try {
      parseWorktreePorcelain("worktree /repo\0branch refs/heads/main\0\0");
    } catch (error) {
      expect(error).toMatchObject({ recordIndex: 0, field: "HEAD" });
      expect(String(error)).toContain("expected HEAD field");
    }
  });
});
