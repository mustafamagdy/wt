# Git Worktree Manager (`wt`)

🚀 A typed Git worktree library plus a polished, cross-platform CLI.

## Library API

The public API treats Git's worktree registry as the source of truth. It uses
the NUL-delimited porcelain format, so unusual paths are preserved exactly.

```ts
import { WorktreeManager } from "git-wt/core";

const worktrees = new WorktreeManager({ cwd: "/path/to/repository" });

const state = worktrees.list();
worktrees.add({ path: "/worktrees/my-feature", branch: "feature/my-feature", startPoint: "main" });
worktrees.lock("/worktrees/my-feature", "long-running task");
worktrees.move("/worktrees/my-feature", "/worktrees/my-feature-renamed");
worktrees.unlock("/worktrees/my-feature-renamed");
worktrees.remove("/worktrees/my-feature-renamed");
```

Every mutation returns the registry state before and after the command. The
runner is injectable for tests and automation. Destructive operations require
an exact registered path and never recursively delete an arbitrary directory.

Use `wt list --current --json` for machine-readable CLI output.

## Features

- ✅ **Cross-platform**: Native Node.js CLI for macOS, Linux, and Windows
- 🎨 **Readable output**: TTY-aware colors, aligned tables, and `NO_COLOR` support
- 🔍 **Smart matching**: Partial branch name matching with interactive selection
- 🏷️ **Tagging system**: Organize worktrees with custom tags/groups
- ⏰ **Time machine**: Create worktrees from specific dates
- 📊 **Disk usage**: Monitor storage usage with totals
- 🎯 **Interactive menus**: Keyboard-driven selection, confirmation, and cancellation
- 🔄 **Smart sync**: Auto-sync with origin/main using rebase/merge with stash management
- 📄 **File copying**: Copy configuration files when creating worktrees
- 🔍 **Dry-run mode**: Preview deletions with safety warnings before executing

## Installation

```bash
bun add --global git-wt
```

## Quick Start

```bash
# List all worktrees
wt list

# List worktrees matching pattern
wt list sms

# List only worktrees for current repository
wt list --current

# Create new branch + worktree
wt create feature/new-ui

# Create new branch from a specific base branch
wt create feature/new-ui main
wt create hotfix/urgent develop

# Create with config files copied
wt create feature/api --copy .env,.env.local

# Create with all claude files/directories copied
wt create test --copy "claude*"

# Create worktree in a custom location instead of ~/.worktrees
wt create feat -d ~/scratch

# Switch to worktree (partial matching)
wt sw feat

# Sync with latest changes (auto-detects current branch if no argument)
wt sync
wt sync feat

# Preview deletion (dry-run)
wt delete test --dry-run

# Delete worktree (with interactive selection and confirmation)
wt delete test

# Tag worktree for organization
wt tag feature ui

# Switch by tag
wt sg ui
```

## Commands

### Core Commands
- `wt list | ls | l [pattern] [--current]` - List all worktrees with status (optional pattern filter, --current shows only current repo worktrees)
- `wt create | new [branch] [base] [--copy <patterns>] [-d <path>]` - Create new branch + worktree (optionally from a `<base>` branch, optionally copy files/dirs, optionally override worktree location). With no branch, asks for a name and lets you search for the base
- `wt checkout | co [branch] [-d <path>]` - Checkout existing branch in worktree. With no branch, search local and origin branches that have no worktree yet
- `wt switch | sw [partial]` - Switch to worktree by partial branch name. With no name, or several matches, search the list
- `wt delete | rm [partial] [--dry-run] [--yes] [--force]` - Delete worktree with a risk preview and confirmation. With no name, or several matches, tick several worktrees grouped by repository and delete them in parallel (ones with uncommitted changes are kept unless `--force`)

### Workflow Commands
- `wt push` - Commit all changes & push current worktree (creates origin if missing)
- `wt sync [partial]` - Sync worktree with origin/main (auto stash/unstash, auto-detects current branch)
- `wt du` - Show disk usage per worktree (with total)
- `wt clean [--current] [--dry-run] [--dangerous-accept] [--delete-branch] [--no-fetch]` - Remove worktrees whose work is already merged, squash merged, or pushed. Checks run in parallel, results are grouped by repository, and you pick which ones to remove

Missing arguments are only asked for in a terminal. In scripts and CI, a
missing argument is still an error, so pass it explicitly.

### Organization Commands
- `wt tag [partial] [tag]` - Tag a worktree with group label. Missing values are asked for
- `wt switchg | sg [tag]` - Switch to worktree by tag. With no tag, search existing tags

### Advanced Commands
- `wt time | tm <branch>@<YYYY-MM-DD>` - Create detached worktree from specific date

## Examples

### Basic Workflow
```bash
# Create feature branch from main
wt create feature/user-auth main

# Create with config files copied
wt create feature/user-auth --copy .env,.env.local

# Work on feature, sync with latest main
wt sync feature/user-auth

# Work on feature, then push
wt push

# Switch to another feature (partial matching)
wt sw bug    # Matches "bugfix/login-issue"

# Preview deletion first
wt delete old-feature --dry-run

# Delete old worktree
wt delete old-feature
```

### File Copying with Patterns
```bash
# Copy single file when creating worktree
wt create feature/api --copy .env

# Copy multiple files
wt create feature/ui --copy .env,.env.local,config.json

# Copy entire directories
wt create feature/docs --copy docs/

# Copy with glob patterns (use quotes to prevent shell expansion)
wt create test --copy "claude*"           # Copies claude.md, .claude/, claude-config.json
wt create api --copy ".env*"              # Copies .env, .env.local, .env.production
wt create setup --copy "config/,*.md"    # Copies config directory and all markdown files
```

### Sync Operations
```bash
# Auto-detect current branch and sync
wt sync

# Sync specific branch with latest main
wt sync feature-branch

# Automatically handles:
# - Auto-detection of current branch (if no argument provided)
# - Fallback to local main/master if remote not available
# - Stashing uncommitted changes
# - Fetching latest origin/main (if remote exists)
# - Rebasing (or merging if rebase fails)
# - Restoring stashed changes
```

### Safe Deletion
```bash
# Preview what would be deleted
wt delete feature --dry-run
# Shows: directory, branch, uncommitted changes, unpushed commits, disk usage

# Actually delete
wt delete feature

# Skip confirmation in automation
wt delete feature --yes
```

### Cleaning Up Finished Worktrees
```bash
# Fetch, check every managed worktree in parallel, then pick which to remove
wt clean

# Only this repository's worktrees, and delete their local branches too
wt clean --current --delete-branch

# Preview only
wt clean --dry-run

# Scripts and CI: remove every safe worktree without prompting
wt clean --dangerous-accept
```

A worktree is offered for removal only when it has no uncommitted or untracked
changes and its commit is merged into the default branch (including squash and
rebase merges) or exists on a remote branch. The main checkout, locked
worktrees, and the worktree you are standing in are never removed.

### Organization with Tags
```bash
# Tag worktrees by project area
wt tag frontend ui
wt tag backend api
wt tag feature/auth ui

# Switch to any UI-related worktree
wt sg ui
```

### Time Machine
```bash
# Create worktree from main branch 30 days ago
wt time main@2024-01-01

# Investigate bug from specific date
wt time develop@2024-06-15
```

### Pattern Filtering
```bash
# List only worktrees matching "sms" 
wt list sms
wt l api      # Short alias
wt ls test    # Alternative alias

# List only worktrees for current repository
wt list --current

# Combine current repo filter with pattern
wt list --current feature

# Pattern matches branch names, project names, and paths
wt list feature    # Shows all feature branches
wt list ui         # Shows UI-related worktrees
```

## Configuration

Worktrees are stored in `~/.worktrees/` by default. Override this per command with `--dir`, or globally with `WT_WORKTREES_DIR`.

### Folder Structure

Here's how your worktrees are organized:

```
~/
└── .worktrees/
    ├── main/
    ├── feature-user-auth/
    ├── bugfix-login-issue/
    ├── develop/
    ├── hotfix-security-patch/
    └── feature-api/
```

Each folder contains a complete working directory for that branch. Branch names with `/` are converted to `-` for folder names.

**Key Benefits:**
- 🔄 **Switch instantly** between branches without git checkout delays
- 🏃‍♂️ **Run multiple branches** simultaneously (dev server, tests, etc.)
- 🛡️ **Isolated changes** - no risk of mixing uncommitted work
- 💾 **Preserved state** - each branch maintains its own working directory

## Options

- `-f, --force` - Force operations (overwrite/remove)
- `-d, --dir <path>` - Use a different managed worktree directory
- `--copy <patterns>` - Copy files/directories matching patterns to worktree (create only)
- `--current` - Show only worktrees for current repository (list only)
- `--dry-run` - Show what would be deleted without doing it (delete only)
- `-y, --yes` - Skip an interactive confirmation where supported
- `--no-shell` - Create the worktree without opening a shell (create, checkout, and time)
- `-h, --help` - Show help

Colors are automatically disabled when output is redirected. Set `NO_COLOR=1` to disable them explicitly.

## Interactive Selection

When multiple worktrees match your partial input, `wt` presents a keyboard-driven selection prompt. In a non-interactive environment it fails safely and asks for a more specific value instead of guessing.

```bash
❯ wt delete test
Multiple worktrees match 'test':
  test-feature (/Users/you/.worktrees/test-feature)
  test-bugfix (/Users/you/.worktrees/test-bugfix)
  testing-ui (/Users/you/.worktrees/testing-ui)

◆  Multiple worktrees match 'test'
│  ● test-feature  /Users/you/.worktrees/test-feature
│    test-bugfix   /Users/you/.worktrees/test-bugfix
└
```

## Requirements

- Git (with worktree support)
- Node.js 20.12 or newer
- Bun for source development and releases

## Platform Support

| Platform | Runtime | Status |
|----------|---------|--------|
| macOS    | Node.js 20.12+ | ✅ Native |
| Linux    | Node.js 20.12+ | ✅ Native |
| Windows  | Node.js 20.12+ | ✅ Native |
| WSL      | Node.js 20.12+ | ✅ Native |

## Development

The source is TypeScript. Bun type-checks, tests, and bundles it into the single executable published as `bin/wt`.

```bash
bun install
bun run check
bun test
bun run build
bun run verify
```

The CLI uses Commander for strict command parsing, Clack for prompt primitives, and picocolors for TTY-aware styling. Git remains the source of truth; the implementation invokes Git directly rather than reimplementing repository semantics.

## Contributing

1. Fork the repository
2. Create your feature branch (`wt create feature/amazing-feature`)
3. Commit your changes (`wt push`)
4. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Changelog

### v2.0.0
- 🚀 **REWRITTEN**: Native TypeScript CLI bundled into a single Node.js executable with Bun.
- 🎨 **NEW**: TTY-aware colors, aligned tables, keyboard-driven selections, and structured confirmations.
- 🛡️ **SAFER**: Destructive deletion now shows risk context and asks for confirmation unless `--yes` or `--force` is provided.
- 🪟 **CROSS-PLATFORM**: Windows now runs natively on Node.js instead of requiring Git Bash.
- 🧪 **TESTED**: Integration coverage for create, checkout, list, copy, tag, delete, sync, push, time-machine, external paths, and non-interactive behavior.
- 🐛 **FIXED**: `wt sync` now searches the resolved current branch instead of the original empty argument.

### v1.0.6
- ✨ **NEW**: `-d, --dir <path>` overrides the worktree location for create, checkout, and time commands.
- 🐛 **FIXED**: `wt list --current` now uses Git's worktree registry, discovering worktrees outside `~/.worktrees`.
- 🔧 **ENHANCED**: Current-repository listing supports paths with spaces and consistent project names without an origin remote.

### v1.0.5
- ✨ **NEW**: `wt create <branch> <base>` - Create new branch + worktree from a specific base branch (local or remote). Falls back to current HEAD when base is omitted.
- 🔧 **ENHANCED**: Validates that the base branch exists locally or on origin before creating.

### v1.0.4
- 🐛 **FIXED**: `--current` flag now properly implemented and functional
- 🔧 **ENHANCED**: Improved argument parsing to handle `--current` flag correctly
- 🔧 **ENHANCED**: Better repository matching logic for current repo filtering

### v1.0.3
- ✨ **NEW**: `--current` flag for list command - Filter worktrees to show only those from current repository
- 🔧 **ENHANCED**: Better repository filtering - Uses origin URL to match worktrees from same repository
- 📚 **DOCS**: Updated README with --current flag examples and usage

### v1.0.2
- ✨ **NEW**: `wt l` alias for list command - Quick listing with `wt l`
- ✨ **NEW**: Pattern filtering for list command - `wt list <pattern>` to filter results
- ✨ **NEW**: Auto-detection for sync command - `wt sync` without arguments detects current branch
- ✨ **NEW**: Enhanced copy patterns - Support for glob patterns like `"claude*"` to copy files and directories
- ✨ **NEW**: Smart origin creation for push - Automatically creates GitHub remote when missing
- 🔧 **ENHANCED**: Improved sync fallback - Uses local main/master when remote branches not available
- 🔧 **ENHANCED**: Better glob pattern support - Hidden files, directories, and symlinks
- 🔧 **ENHANCED**: Rsync integration for directory copying (when available)
- 🐛 **FIXED**: Unbound variable error in find_matching_worktrees function
- 🐛 **FIXED**: Git directory exclusion during file copying operations
- 🔒 **SECURITY**: Automatic .git directory exclusion in copy operations

### v1.0.1
- ✨ **NEW**: `wt sync` command - Smart sync with origin/main using rebase/merge
- ✨ **NEW**: `--copy` option for create command - Copy files from main directory to worktree
- ✨ **NEW**: `--dry-run` option for delete command - Preview deletions with safety warnings
- 🎨 **IMPROVED**: Enhanced help layout with better formatting and emojis
- 🐛 **FIXED**: Removed unnecessary D* column from worktree list output
- 🔧 **ENHANCED**: Better detection of uncommitted changes including untracked files

### v1.0.0
- Initial release
- Cross-platform support (macOS, Linux, Windows)
- Partial matching with interactive selection
- Tagging system for worktree organization
- Time machine functionality
- Disk usage monitoring with totals
