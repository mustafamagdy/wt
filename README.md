# Worktree Manager (`wt`)

🚀 A powerful, cross-platform Git worktree management tool with intelligent partial matching and tagging.

## Features

- ✅ **Cross-platform**: Works on macOS, Linux, and Windows (Git Bash/WSL)
- 🔍 **Smart matching**: Partial branch name matching with interactive selection
- 🏷️ **Tagging system**: Organize worktrees with custom tags/groups
- ⏰ **Time machine**: Create worktrees from specific dates
- 📊 **Disk usage**: Monitor storage usage with totals
- 🎯 **Interactive menus**: User-friendly selection for multiple matches

## Installation

```bash
npm install -g worktree-manager
```

## Quick Start

```bash
# List all worktrees
wt list

# Create new branch + worktree
wt create feature/new-ui

# Switch to worktree (partial matching)
wt sw feat

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
- `wt create | new <branch>` - Create new branch + worktree
- `wt checkout | co <branch>` - Checkout existing branch in worktree
- `wt switch | sw <partial>` - Switch to worktree by partial branch name
- `wt delete | rm <partial>` - Delete worktree (supports partial matching)

### Workflow Commands
- `wt push` - Commit all changes & push current worktree
- `wt du` - Show disk usage per worktree (with total)

### Organization Commands
- `wt tag <partial> <tag>` - Tag a worktree with group label
- `wt switchg | sg <tag>` - Switch to worktree by tag

### Advanced Commands
- `wt time | tm <branch>@<YYYY-MM-DD>` - Create detached worktree from specific date

## Examples

### Basic Workflow
```bash
# Create feature branch
wt create feature/user-auth

# Work on feature, then push
wt push

# Switch to another feature (partial matching)
wt sw bug    # Matches "bugfix/login-issue"

# Delete old worktree
wt delete old-feature
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

## Options

- `-f, --force` - Force operations (overwrite/remove)
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

### v1.0.0
- Initial release
- Cross-platform support (macOS, Linux, Windows)
- Partial matching with interactive selection
- Tagging system for worktree organization
- Time machine functionality
- Disk usage monitoring with totals