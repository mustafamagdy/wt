import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderFromBranch, worktreesDirectory } from "./config.js";
import { git } from "./git.js";
import { listWorktrees, repositoryName } from "./worktrees.js";

const fixtures: string[] = [];

function repositoryFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "wt-ts-test-"));
  fixtures.push(root);
  const repository = join(root, "sample-repo");
  git(["init", "-q", "-b", "main", repository]);
  git(["config", "user.name", "WT Test"], repository);
  git(["config", "user.email", "wt@example.com"], repository);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  git(["add", "README.md"], repository);
  git(["commit", "-qm", "initial"], repository);
  return repository;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("worktree discovery", () => {
  test("uses Git's registry and preserves paths containing spaces", () => {
    const repository = repositoryFixture();
    const linked = join(repository, "..", "feature with spaces");
    git(["branch", "feature/one"], repository);
    git(["worktree", "add", "-q", linked, "feature/one"], repository);

    const items = listWorktrees({ root: join(repository, ".unused"), current: true, cwd: linked });
    expect(items.map((item) => realpathSync(item.path))).toEqual([realpathSync(repository), realpathSync(linked)]);
    expect(items.every((item) => item.project === "sample-repo")).toBe(true);
  });

  test("filters by branch, project, or path", () => {
    const repository = repositoryFixture();
    git(["branch", "feature/searchable"], repository);
    const linked = join(repository, "..", "linked-location");
    git(["worktree", "add", "-q", linked, "feature/searchable"], repository);

    expect(listWorktrees({ root: "unused", current: true, cwd: repository, pattern: "searchable" })).toHaveLength(1);
    expect(listWorktrees({ root: "unused", current: true, cwd: repository, pattern: "missing" })).toHaveLength(0);
  });

  test("derives a stable project name without an origin", () => {
    const repository = repositoryFixture();
    expect(repositoryName(repository)).toBe("sample-repo");
  });
});

describe("configuration", () => {
  test("maps slash-delimited branches to managed folders", () => {
    expect(folderFromBranch("feature/pro-cli")).toBe("feature-pro-cli");
  });

  test("resolves relative directory overrides from the current directory", () => {
    expect(worktreesDirectory("custom-worktrees")).toBe(join(process.cwd(), "custom-worktrees"));
  });
});
