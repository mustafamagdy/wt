# Worktree Management

This context describes Git worktrees as durable repository registrations plus optional filesystem checkouts. The package manages both without guessing from folder names.

## Language

**Repository**:
One Git repository identity, defined by its common Git directory. A repository can have many worktree registrations.
_Avoid_: Project, repo folder

**Worktree registration**:
A record owned by Git that links a path to a HEAD and optional branch. The path may be missing while the registration still exists.
_Avoid_: Folder, directory entry

**Working tree**:
The filesystem checkout at a registered worktree path. It exists only when that path is present and valid.
_Avoid_: Worktree registration

**Managed worktree**:
A worktree registration explicitly created or adopted by `wt`. Management is recorded as metadata, not inferred from its path.
_Avoid_: Anything under `~/.worktrees`

**Stale registration**:
A Git registration whose working tree is missing and which Git marks as prunable.
_Avoid_: Broken folder, deleted worktree

**Worktree selector**:
An exact path, branch, or stable identifier used to choose a registration. Partial text is only an interactive convenience and must never silently choose between matches.
_Avoid_: Folder name
