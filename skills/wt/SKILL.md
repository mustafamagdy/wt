---
name: wt
description: "Manage Git worktrees with the `wt` CLI (npm package git-wt): create, check out, list, sync, delete, and clean up worktrees across repositories. Use when the user mentions wt or git-wt, or asks to create, list, remove, or clean up Git worktrees and `wt` is installed. Do not use for plain branch work that needs no separate worktree."
---

# wt

`wt` manages Git worktrees: separate checkouts of one repository, each on its own branch, living side by side on disk. Git's worktree registry (`git worktree list`) is the source of truth; `wt` never guesses from folder names and never deletes a folder Git does not know about.

## Learn the installed CLI

The installed binary is the authority for syntax. Read help before relying on a flag:

```bash
wt --help
wt <command> --help
```

`wt --help` and `wt <command> --help` are safe. Do not probe a command by running it without arguments to see what happens: some commands create or delete things.

## Where worktrees live

- **Managed directory**: `~/.worktrees` by default. Override per command with `-d, --dir <path>` or globally with `WT_WORKTREES_DIR`. Most commands only look here.
- A worktree folder is named after its branch with `/` replaced by `-`: branch `feature/login` lives in `~/.worktrees/feature-login`.
- `--current` (on `list` and `clean`) means "every worktree registered to the repository I am in", including ones outside the managed directory.

## Rules for agents

You run without an interactive terminal. `wt` is built for both humans and scripts, and behaves differently without a terminal:

1. **Always pass every argument.** In a terminal, a missing branch or name opens a picker. Without one, it fails with `Missing ... Pass it as an argument`. Several matches for a partial name also fail without a terminal; pass a more specific name.
2. **Always pass `--no-shell`** to `create`, `checkout`, and `time`. Otherwise they try to open a shell inside the new worktree.
3. **Do not use `switch` or `switch-group`.** They only open a shell. To work in a worktree, find its path with `wt list --json` and use that path as your working directory.
4. **Destructive commands need explicit flags** because confirmation prompts answer "no" without a terminal. Only add these flags after the user has agreed to the removal:
   - `delete` needs `--yes`, and `--force` to also discard uncommitted changes.
   - `clean` needs `--dangerous-accept`.
   - `sync` with no name needs `--yes`.
5. **Preview first.** `delete --dry-run` and `clean --dry-run` change nothing and show exactly what would go. Show the user the result before running the real command.
6. **Read state as JSON.** Use `wt list --json` (managed directory) or `wt list --current --json` (this repository). Do not parse the human tables.

## Commands

Partial names match branch names by case-insensitive substring.

| Goal | Command |
| --- | --- |
| List worktrees as JSON | `wt list --json` or `wt list --current --json` |
| New branch plus worktree | `wt create <branch> [base] --no-shell` |
| Copy untracked files into a new worktree | `wt create <branch> --copy ".env,.env.local" --no-shell` |
| Existing local or origin branch in a worktree | `wt checkout <branch> --no-shell` |
| Detached worktree at a past date | `wt time <branch>@<YYYY-MM-DD> --no-shell` |
| Rebase a worktree onto origin/main | `wt sync <partial>` |
| Remove one worktree | `wt delete <partial> --dry-run`, then `wt delete <partial> --yes` |
| Remove every finished worktree | `wt clean --dry-run`, then `wt clean --dangerous-accept` |
| Disk usage per worktree | `wt du` |
| Label a worktree | `wt tag <partial> <tag>` |

`wt list --json` returns an array of objects with `path`, `branch`, `project`, `detached`, `prunable`, `dirty`, and `upstream` (absent when the branch has no upstream).

## Cleaning up

`wt clean` fetches every repository once, then checks all worktrees in parallel. A worktree counts as safe to remove only when it has no uncommitted or untracked changes and its commit is:

- merged into the default branch, or
- squash or rebase merged into it, or
- present on a remote branch.

If its folder was already deleted by hand, `clean` removes the leftover registration. It never removes the main checkout, locked worktrees, or the worktree the command runs from.

```bash
wt clean --dry-run                              # see what is safe, grouped by repository
wt clean --dangerous-accept                     # remove all safe ones (only with user approval)
wt clean --current --dry-run                    # only this repository
wt clean --dangerous-accept --delete-branch     # also delete their local branches
wt clean --dry-run --no-fetch                   # skip fetching (faster, may be stale)
```

Exit code 1 means at least one removal failed; the output names each one and why.

## Things to watch

- `sync` stashes local changes, rebases onto `origin/main` (or `master`, or the local equivalents), falls back to a merge if the rebase fails, then restores the stash. Tell the user before running it on a worktree with uncommitted work.
- `push` stages **everything** (`git add -A`), commits, and pushes the current branch. It needs `-m <message>` without a terminal. Prefer ordinary `git add`, `git commit`, and `git push` when you should control what gets committed.
- `tag` writes a `.wt-tags` file inside the worktree. That untracked file makes the worktree look dirty, so `clean` will keep it.
- `delete` without `--force` refuses to remove a worktree with uncommitted changes; that is the safety net, not an error to work around.

## Library

The same rules are available from TypeScript through the `git-wt/core` package export: `WorktreeManager` for exact list, add, remove, move, lock, unlock, repair, and prune; `analyzeCleanup` and `executeCleanup` for the clean logic. Prefer the CLI unless the user is writing code against the library.
