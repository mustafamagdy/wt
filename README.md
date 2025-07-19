# Git Worktree Manager (`wt`)

🚀 A powerful, cross-platform Git worktree management tool with intelligent partial matching and tagging.

## Features

- ✅ **Cross-platform**: Works on macOS, Linux, and Windows (Git Bash/WSL)
- 🔍 **Smart matching**: Partial branch name matching with interactive selection
- 🏷️ **Tagging system**: Organize worktrees with custom tags/groups
- ⏰ **Time machine**: Create worktrees from specific dates
- 📊 **Disk usage**: Monitor storage usage with totals
- 🎯 **Interactive menus**: User-friendly selection for multiple matches
- 🔄 **Smart sync**: Auto-sync with origin/main using rebase/merge with stash management
- 📄 **File copying**: Copy configuration files when creating worktrees
- 🔍 **Dry-run mode**: Preview deletions with safety warnings before executing

## Installation

```bash
npm install -g git-wt
```

## Quick Start

```bash
# List all worktrees
wt list

# Create new branch + worktree
wt create feature/new-ui

# Create with config files copied
wt create feature/api --copy .env,.env.local

# Switch to worktree (partial matching)
wt sw feat

# Sync with latest changes
wt sync feat

# Preview deletion (dry-run)
wt delete test --dry-run

# Delete worktree (with interactive selection)
wt delete test

# Tag worktree for organization
wt tag feature ui

# Switch by tag
wt sg ui
```

## Commands

### Core Commands
- `wt list | ls` - List all worktrees with status
- `wt create | new <branch> [--copy <files>]` - Create new branch + worktree (optionally copy files)
- `wt checkout | co <branch>` - Checkout existing branch in worktree
- `wt switch | sw <partial>` - Switch to worktree by partial branch name
- `wt delete | rm <partial> [--dry-run]` - Delete worktree (supports partial matching & dry-run)

### Workflow Commands
- `wt push` - Commit all changes & push current worktree
- `wt sync <partial>` - Sync worktree with origin/main (auto stash/unstash)
- `wt du` - Show disk usage per worktree (with total)

### Organization Commands
- `wt tag <partial> <tag>` - Tag a worktree with group label
- `wt switchg | sg <tag>` - Switch to worktree by tag

### Advanced Commands
- `wt time | tm <branch>@<YYYY-MM-DD>` - Create detached worktree from specific date

## Examples

### Basic Workflow
```bash
# Create feature branch with config files
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

### File Copying
```bash
# Copy single file when creating worktree
wt create feature/api --copy .env

# Copy multiple files
wt create feature/ui --copy .env,.env.local,config.json

# Copy entire directories
wt create feature/docs --copy docs/
```

### Sync Operations
```bash
# Sync current feature with latest main
wt sync feature-branch

# Automatically handles:
# - Stashing uncommitted changes
# - Fetching latest origin/main
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
```

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

## Configuration

Worktrees are stored in `~/.worktrees/` by default. On Windows, uses `%USERPROFILE%/.worktrees/`.

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
- `--copy <files>` - Copy comma-separated files from main dir to worktree (create only)
- `--dry-run` - Show what would be deleted without doing it (delete only)
- `-h, --help` - Show help

## Interactive Selection

When multiple worktrees match your partial input, you'll see an interactive menu:

```bash
❯ wt delete test
Multiple worktrees match 'test':
  test-feature (/Users/you/.worktrees/test-feature)
  test-bugfix (/Users/you/.worktrees/test-bugfix)
  testing-ui (/Users/you/.worktrees/testing-ui)

Select branch:
1) test-feature
2) test-bugfix  
3) testing-ui
Select option (1-3): 
```

## Requirements

- Git (with worktree support)
- Bash shell (available on all platforms via Git Bash on Windows)

## Platform Support

| Platform | Shell | Status |
|----------|-------|--------|
| macOS    | bash/zsh | ✅ Native |
| Linux    | bash/sh | ✅ Native |
| Windows  | Git Bash | ✅ Via Git for Windows |
| Windows  | WSL | ✅ Via Windows Subsystem for Linux |

## Contributing

1. Fork the repository
2. Create your feature branch (`wt create feature/amazing-feature`)
3. Commit your changes (`wt push`)
4. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Changelog

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