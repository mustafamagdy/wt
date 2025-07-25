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

# List worktrees matching pattern
wt list sms

# List only worktrees for current repository
wt list --current

# Create new branch + worktree
wt create feature/new-ui

# Create with config files copied
wt create feature/api --copy .env,.env.local

# Create with all claude files/directories copied
wt create test --copy "claude*"

# Switch to worktree (partial matching)
wt sw feat

# Sync with latest changes (auto-detects current branch if no argument)
wt sync
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
- `wt list | ls | l [pattern] [--current]` - List all worktrees with status (optional pattern filter, --current shows only current repo worktrees)
- `wt create | new <branch> [--copy <patterns>]` - Create new branch + worktree (optionally copy files/dirs)
- `wt checkout | co <branch>` - Checkout existing branch in worktree
- `wt switch | sw <partial>` - Switch to worktree by partial branch name
- `wt delete | rm <partial> [--dry-run]` - Delete worktree (supports partial matching & dry-run)

### Workflow Commands
- `wt push` - Commit all changes & push current worktree (creates origin if missing)
- `wt sync [partial]` - Sync worktree with origin/main (auto stash/unstash, auto-detects current branch)
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
- `--copy <patterns>` - Copy files/directories matching patterns to worktree (create only)
- `--current` - Show only worktrees for current repository (list only)
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