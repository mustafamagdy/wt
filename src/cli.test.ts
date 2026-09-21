import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./git.js";
import { run } from "./git.js";

const cli = fileURLToPath(new URL("cli.ts", import.meta.url));
const project = dirname(dirname(cli));
const fixtures: string[] = [];

function fixture(): { repository: string; managed: string } {
  const root = mkdtempSync(join(tmpdir(), "wt-cli-test-"));
  fixtures.push(root);
  const repository = join(root, "repository");
  const managed = join(root, "managed");
  git(["init", "-q", "-b", "main", repository]);
  git(["config", "user.name", "WT Test"], repository);
  git(["config", "user.email", "wt@example.com"], repository);
  writeFileSync(join(repository, "tracked.txt"), "fixture\n");
  git(["add", "tracked.txt"], repository);
  git(["commit", "-qm", "initial"], repository);
  return { repository, managed };
}

function wt(args: string[], cwd: string) {
  return run("bun", [cli, ...args], { cwd, allowFailure: true });
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("CLI", () => {
  test("renders professional command help", () => {
    const result = wt(["--help"], project);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("A fast, polished Git worktree manager");
    expect(result.stdout).toContain("create [options] [branch] [base]");
  });

  test("prints the agent skill file", () => {
    const result = wt(["--skill"], project);
    expect(result.status).toBe(0);
    expect(result.stdout).toStartWith("---\nname: wt\n");
    expect(result.stdout).toContain("--dangerous-accept");
    expect(wt(["--help"], project).stdout).toContain("wt --skill");
  });

  test("creates, lists, tags, previews deletion, and removes a worktree", () => {
    const { repository, managed } = fixture();
    const created = wt(["create", "feature/pro", "--dir", managed, "--no-shell"], repository);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Worktree ready");

    const listed = wt(["list", "--dir", managed], repository);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("feature/pro");

    expect(wt(["tag", "feature/pro", "ux", "--dir", managed], repository).status).toBe(0);
    const preview = wt(["delete", "feature/pro", "--dir", managed, "--dry-run"], repository);
    expect(preview.stdout).toContain("Deletion preview");
    expect(preview.stdout).toContain("feature/pro");

    const removed = wt(["delete", "feature/pro", "--dir", managed, "--yes", "--force"], repository);
    expect(removed.status).toBe(0);
    expect(wt(["list", "--dir", managed], repository).stdout).toContain("No worktrees found");
  });

  test("lists worktrees outside the managed directory with --current", () => {
    const { repository, managed } = fixture();
    const outside = join(dirname(repository), "outside managed directory");
    git(["branch", "external"], repository);
    git(["worktree", "add", "-q", outside, "external"], repository);
    const result = wt(["list", "--current", "external", "--dir", managed], outside);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(outside);
  });

  test("prints machine-readable JSON without UI text", () => {
    const { repository, managed } = fixture();
    git(["branch", "json-output"], repository);
    git(["worktree", "add", "-q", join(managed, "json-output"), "json-output"], repository);
    const result = wt(["list", "--current", "--json", "--dir", managed], repository);
    expect(result.status).toBe(0);
    const items = JSON.parse(result.stdout) as Array<{ branch: string; path: string }>;
    expect(items.some((item) => item.branch === "json-output" && item.path.endsWith("/json-output"))).toBe(true);
  });

  test("force checkout never deletes an unregistered directory", () => {
    const { repository, managed } = fixture();
    git(["branch", "occupied"], repository);
    const target = join(managed, "occupied");
    git(["init", "-q", target], repository);
    writeFileSync(join(target, "keep.txt"), "keep\n");
    const result = wt(["checkout", "occupied", "--force", "--dir", managed, "--no-shell"], repository);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to use an unregistered Git directory");
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep\n");
  });

  test("copies matching files without copying Git metadata", () => {
    const { repository, managed } = fixture();
    writeFileSync(join(repository, ".env.example"), "SAFE=value\n");
    const result = wt(["create", "copied", "--dir", managed, "--copy", ".env*", "--no-shell"], repository);
    expect(result.status).toBe(0);
    expect(readFileSync(join(managed, "copied", ".env.example"), "utf8")).toBe("SAFE=value\n");
    expect(existsSync(join(managed, "copied", ".git", "config"))).toBe(false);
  });

  test("checks out an existing branch and creates a time-machine worktree", () => {
    const { repository, managed } = fixture();
    git(["branch", "existing"], repository);
    const checkout = wt(["checkout", "existing", "--dir", managed, "--no-shell"], repository);
    expect(checkout.status).toBe(0);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], join(managed, "existing")).stdout).toBe("existing");

    const time = wt(["time", "main@2099-01-01", "--dir", managed, "--no-shell"], repository);
    expect(time.status).toBe(0);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], join(managed, "main-2099-01-01")).stdout).toBe("HEAD");
  });

  test("syncs a managed branch onto local main", () => {
    const { repository, managed } = fixture();
    expect(wt(["create", "feature/sync", "--dir", managed, "--no-shell"], repository).status).toBe(0);
    writeFileSync(join(repository, "from-main.txt"), "main\n");
    git(["add", "from-main.txt"], repository);
    git(["commit", "-qm", "advance main"], repository);

    const synced = wt(["sync", "feature/sync", "--dir", managed], repository);
    expect(synced.status).toBe(0);
    expect(readFileSync(join(managed, "feature-sync", "from-main.txt"), "utf8")).toBe("main\n");
  });

  test("commits and pushes to an existing origin", () => {
    const { repository } = fixture();
    const bare = join(dirname(repository), "origin.git");
    git(["init", "-q", "--bare", bare]);
    git(["remote", "add", "origin", bare], repository);
    writeFileSync(join(repository, "pushed.txt"), "published\n");

    const pushed = wt(["push", "--message", "test push"], repository);
    expect(pushed.status).toBe(0);
    expect(git(["show", "main:pushed.txt"], bare).stdout).toBe("published");
  });

  test("fails safely when an interactive choice is ambiguous without a TTY", () => {
    const { repository, managed } = fixture();
    git(["branch", "feature/one"], repository);
    git(["branch", "feature/two"], repository);
    git(["worktree", "add", "-q", join(managed, "feature-one"), "feature/one"], repository);
    git(["worktree", "add", "-q", join(managed, "feature-two"), "feature/two"], repository);
    const result = wt(["switch", "feature", "--dir", managed], repository);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Pass a more specific value");
  });

  test("cleans merged worktrees only after an explicit non-interactive accept", () => {
    const { repository, managed } = fixture();
    git(["branch", "done"], repository);
    git(["branch", "wip"], repository);
    git(["worktree", "add", "-q", join(managed, "done"), "done"], repository);
    git(["worktree", "add", "-q", join(managed, "wip"), "wip"], repository);
    writeFileSync(join(managed, "wip", "draft.txt"), "draft\n");

    const preview = wt(["clean", "--dry-run", "--no-fetch", "--dir", managed], repository);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain("uncommitted changes");
    expect(preview.stdout).toContain("Dry run");

    const refused = wt(["clean", "--no-fetch", "--dir", managed], repository);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("--dangerous-accept");
    expect(existsSync(join(managed, "done"))).toBe(true);

    const cleaned = wt(["clean", "--no-fetch", "--dangerous-accept", "--dir", managed], repository);
    expect(cleaned.status).toBe(0);
    expect(existsSync(join(managed, "done"))).toBe(false);
    expect(existsSync(join(managed, "wip", "draft.txt"))).toBe(true);
  });

  test("asks for missing arguments only in a terminal", () => {
    const { repository, managed } = fixture();
    git(["branch", "picker"], repository);
    git(["worktree", "add", "-q", join(managed, "picker"), "picker"], repository);
    for (const args of [["switch"], ["delete"], ["checkout"], ["create"], ["switch-group"]]) {
      const result = wt([...args, "--dir", managed], repository);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("run in a terminal to pick one");
    }
  });
});
