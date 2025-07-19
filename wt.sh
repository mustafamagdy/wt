#!/usr/bin/env bash
# ----------------------------------------------------------
# wt – Git worktree manager (refactored)
# ----------------------------------------------------------
# Commands (run `wt help` for full details)
#   wt list | ls                    List worktrees
#   wt create | new <branch>        New branch + worktree
#   wt checkout | co <branch>       Checkout existing branch in worktree
#   wt switch  | sw <partial>       Switch to worktree by partial branch
#   wt delete  | rm <branch>        Remove worktree folder
#   wt push                         Commit & push current worktree
#   wt du                           Show disk usage per worktree
#   wt tag <branch> <tag>           Tag worktree with a group label
#   wt switchg | sg <tag>           Switch to worktree by tag
#   wt time | tm <br>@<YYYY-MM-DD>  Detached worktree before date
# ----------------------------------------------------------
set -euo pipefail

WORKTREES_DIR="${HOME}/.worktrees"

# ---------- usage -----------------------------------------------------------
usage() {
  cat <<EOF
Usage: wt <command> [options]

Common commands
  list | ls                        List all worktrees
  create | new <branch>            Create a new branch + worktree
  checkout | co <branch>           Checkout an existing branch in worktree
  switch | sw <partial>            Switch to worktree matching <partial>
  delete | rm <branch>             Delete a worktree folder (use --force if dirty)
  push                             Commit & push the current worktree
  du                               Show disk usage per worktree
  tag <branch> <tag>               Add a tag (group) to worktree
  switchg | sg <tag>               Switch to a worktree by tag
  time | tm <br>@<YYYY-MM-DD>      Create detached time‑machine worktree
  help                             Show this help

Global options
  -f, --force                      Force overwrite / removal where applicable
EOF
}

# ---------- helpers ---------------------------------------------------------
folder_from_branch() { echo "${1//\//-}"; }
branch_from_folder() { echo "${1//-/\/}"; }

require_repo() { git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "✖ Not inside a Git repository"; exit 1; }; }
ensure_dir()   { mkdir -p "$WORKTREES_DIR"; }

require_no_folder() {
  local dir="$1" force="$2"
  [[ -e "$dir" && "$force" != true ]] && {
    echo "✖ Folder already exists: $dir (use --force to overwrite)"; exit 1;
  }
}

# ---------- git helpers -----------------------------------------------------
add_tag() {            # $1=folder  $2=tag
  local file="$1/.wt-tags"; touch "$file"
  grep -qxF "$2" "$file" || { echo "$2" >> "$file"; sort -u "$file" -o "$file"; }
}

has_tag() {            # $1=folder  $2=tag  → 0 if present
  [[ -f "$1/.wt-tags" ]] && grep -qw "$2" "$1/.wt-tags"
}

commit_before() {      # $1=branch  $2=date → commit id
  git rev-list -n 1 --before="$2 23:59" "$1" 2>/dev/null || true
}

find_matching_worktrees() { # $1=partial_branch_name → array of matching worktree dirs
  local partial="$1" matches=()
  ensure_dir
  for wt_dir in "$WORKTREES_DIR"/*; do
    [[ -d "$wt_dir" && -e "$wt_dir/.git" ]] || continue
    branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
    [[ "$branch" == *"$partial"* ]] && matches+=("$wt_dir")
  done
  printf '%s\n' "${matches[@]}"
}

resolve_branch_interactive() { # $1=partial_branch_name → exact branch name or exits
  local partial="$1" matches=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && matches+=("$line")
  done < <(find_matching_worktrees "$partial")
  
  case ${#matches[@]} in
    0) echo "✖ No worktree found matching '$partial'" >&2; exit 1 ;;
    1) 
      local wt_dir="${matches[0]}"
      git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")"
      ;;
    *) 
      echo "Multiple worktrees match '$partial':" >&2
      local branches=()
      for wt_dir in "${matches[@]}"; do
        local branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
        branches+=("$branch")
        echo "  $branch ($wt_dir)" >&2
      done
      echo -n "Select branch: " >&2
      select branch in "${branches[@]}"; do
        [[ -n "$branch" ]] && { echo "$branch"; return; }
      done >&2
      ;;
  esac
}

# ---------- core features (existing) ----------------------------------------
list_worktrees() {
  printf "\n%-20s %-25s %-25s %-3s %s\n" "PROJECT" "BRANCH" "UPSTREAM" "D*" "PATH"
  printf '%0.1s' "-"{1..105}; echo
  [[ -d "$WORKTREES_DIR" ]] || { echo "No worktrees found in $WORKTREES_DIR"; return; }
  for wt_dir in "$WORKTREES_DIR"/*; do
    [[ -d "$wt_dir" && -e "$wt_dir/.git" ]] || continue
    branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
    upstream=$(git -C "$wt_dir" rev-parse --abbrev-ref @{u} 2>/dev/null || echo "-")
    dirty=" "
    git -C "$wt_dir" diff --quiet && git -C "$wt_dir" diff --cached --quiet || branch="* ${branch}"
    origin_url=$(git -C "$wt_dir" remote get-url origin 2>/dev/null || echo "")
    proj_name=$( [[ -n "$origin_url" ]] && basename "${origin_url%.git}" || basename "$(git -C "$wt_dir" rev-parse --show-toplevel 2>/dev/null)" )
    printf "%-20s %-25s %-25s %-3s %s\n" "$proj_name" "$branch" "$upstream" "$dirty" "$wt_dir"
  done
}

disk_usage() {
  [[ -d "$WORKTREES_DIR" ]] || { echo "No worktrees found in $WORKTREES_DIR"; return; }
  printf "\n%-40s %s\n" "WORKTREE" "SIZE"; printf '%0.1s' "-"{1..60}; echo
  du -sh "$WORKTREES_DIR"/* 2>/dev/null | sort -hr | while read -r size path; do
    printf "%-40s %s\n" "$(basename "$path")" "$size"
  done
  printf '%0.1s' "-"{1..60}; echo
  total=$(du -sh "$WORKTREES_DIR" 2>/dev/null | cut -f1)
  printf "%-40s %s\n" "TOTAL" "$total"
}

commit_and_push() {
  if git diff --quiet && git diff --cached --quiet && [[ -z $(git ls-files --others --exclude-standard) ]]; then
    echo "✓ Nothing to commit. Pushing current branch…"
  else
    read -r -p "Commit message: " msg
    [[ -z "$msg" ]] && { echo "Commit aborted: empty message"; exit 1; }
    git add -A && git commit -m "$msg"
  fi
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  git push -u origin "$current_branch"
}

delete_worktree() {    # $1=partial_branch $2=force
  local partial="$1" force="$2" matches=() branch folder target
  
  while IFS= read -r line; do
    [[ -n "$line" ]] && matches+=("$line")
  done < <(find_matching_worktrees "$partial")
  
  case ${#matches[@]} in
    0) echo "✖ No worktree found matching '$partial'"; exit 1 ;;
    1) 
      local wt_dir="${matches[0]}"
      branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
      ;;
    *) 
      echo "Multiple worktrees match '$partial':"
      local branches=()
      for wt_dir in "${matches[@]}"; do
        local br=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
        branches+=("$br")
        echo "  $br ($wt_dir)"
      done
      echo
      echo "Select branch:"
      select branch in "${branches[@]}"; do
        [[ -n "$branch" ]] && break
      done
      ;;
  esac
  
  folder=$(folder_from_branch "$branch")
  target="$WORKTREES_DIR/$folder"
  [[ -d "$target" ]] || { echo "✖ Worktree not found: $target"; exit 1; }
  git -C "$(git -C "$target" rev-parse --show-toplevel)" worktree remove ${force:+--force} "$target" || {
    echo "✖ Failed to remove worktree (dirty? use --force)"; exit 1; }
  rm -rf "$target" && echo "✓ Worktree deleted: $target"
}

create_or_checkout() {  # $1=mode(create/checkout) $2=branch $3=force
  local mode="$1" branch="$2" force="$3" proj_root folder target
  require_repo; ensure_dir
  proj_root=$(git rev-parse --show-toplevel)
  folder=$(folder_from_branch "$branch")
  target="$WORKTREES_DIR/$folder"
  
  if [[ "$mode" == "create" ]]; then
    # Check if branch already exists BEFORE removing any worktrees
    if git -C "$proj_root" show-ref --verify --quiet "refs/heads/$branch"; then
      echo "✖ Branch '$branch' already exists. Use 'wt checkout $branch' instead."
      exit 1
    fi
  fi
  
  if [[ -e "$target" ]]; then
    git -C "$proj_root" worktree remove ${force:+--force} "$target" 2>/dev/null || true
    rm -rf "$target"
  fi
  
  if [[ "$mode" == "create" ]]; then
    git -C "$proj_root" worktree add -b "$branch" "$target"
  else
    git -C "$proj_root" worktree add "$target" "$branch"
  fi
  echo "✓ Worktree ready at: $target"; cd "$target" && exec "${SHELL:-/bin/bash}"
}

# ---------- new feature helpers --------------------------------------------
cmd_tag() {            # $1=partial_branch $2=tag
  [[ -n "$1" && -n "$2" ]] || { echo "✖ Usage: wt tag <branch> <tag>"; exit 1; }
  local partial="$1" tag="$2" matches=() branch folder target
  
  while IFS= read -r line; do
    [[ -n "$line" ]] && matches+=("$line")
  done < <(find_matching_worktrees "$partial")
  
  case ${#matches[@]} in
    0) echo "✖ No worktree found matching '$partial'"; exit 1 ;;
    1) 
      local wt_dir="${matches[0]}"
      branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
      ;;
    *) 
      echo "Multiple worktrees match '$partial':"
      local branches=()
      for wt_dir in "${matches[@]}"; do
        local br=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || branch_from_folder "$(basename "$wt_dir")")
        branches+=("$br")
        echo "  $br ($wt_dir)"
      done
      echo
      echo "Select branch:"
      select branch in "${branches[@]}"; do
        [[ -n "$branch" ]] && break
      done
      ;;
  esac
  
  folder=$(folder_from_branch "$branch"); target="$WORKTREES_DIR/$folder"
  [[ -d "$target" ]] || { echo "✖ Worktree for '$branch' not found"; exit 1; }
  add_tag "$target" "$tag" && echo "✓ Tagged '$branch' as '$tag'"
}

cmd_switchg() {        # $1=tag
  [[ -n "$1" ]] || { echo "✖ Tag name required"; exit 1; }
  ensure_dir; matches=()
  for wt_dir in "$WORKTREES_DIR"/*; do
    [[ -d "$wt_dir" && -e "$wt_dir/.git" ]] || continue
    has_tag "$wt_dir" "$1" && matches+=("$wt_dir")
  done
  case ${#matches[@]} in
    0) echo "✖ No worktree tagged '$1'"; exit 1 ;;
    1) cd "${matches[0]}" && exec "${SHELL:-/bin/bash}" ;;
    *) echo "Multiple worktrees have tag '$1':"; select wt in "${matches[@]}"; do [[ -n "$wt" ]] && { cd "$wt" && exec "${SHELL:-/bin/bash}"; }; done ;;
  esac
}

cmd_time() {           # $1=branch@date  (YYYY-MM-DD)
  [[ $1 == *"@"* ]] || { echo "✖ Format must be <branch>@<YYYY-MM-DD>"; exit 1; }
  IFS='@' read -r br when <<< "$1"
  require_repo; ensure_dir
  commit=$(commit_before "$br" "$when")
  [[ -z "$commit" ]] && { echo "✖ No commit on '$br' before $when"; exit 1; }
  folder=$(folder_from_branch "${br}-${when}"); target="$WORKTREES_DIR/$folder"
  require_no_folder "$target" "$force"
  git worktree add --detach "$target" "$commit"
  echo "✓ Time‑machine worktree created at $target (commit ${commit:0:7})"
  cd "$target" && exec "${SHELL:-/bin/bash}"
}

cmd_checkout() {       # $1=branch
  [[ -n "$1" ]] || { echo "✖ Branch name required"; exit 1; }
  local_branch="$1"
  local_exists=false; remote_exists=false
  git show-ref --verify --quiet "refs/heads/${local_branch}" && local_exists=true
  git show-ref --verify --quiet "refs/remotes/origin/${local_branch}" && remote_exists=true
  [[ "$local_exists" == false && "$remote_exists" == false ]] && {
    echo "✖ Branch '${local_branch}' does not exist locally or remotely."; exit 1; }
  folder=$(folder_from_branch "$local_branch"); target="$WORKTREES_DIR/$folder"
  
  # If worktree already exists, just switch to it
  if [[ -d "$target" && -e "$target/.git" ]]; then
    echo "✓ Switching to existing worktree at: $target"
    cd "$target" && exec "${SHELL:-/bin/bash}"
    return
  fi
  
  # Remove any stale worktree folder if it exists but isn't a valid git worktree
  if [[ -e "$target" ]]; then
    [[ "$force" == true ]] || { echo "✖ Folder already exists: $target (use --force to overwrite)"; exit 1; }
    rm -rf "$target"
  fi
  
  if [[ "$local_exists" == false && "$remote_exists" == true ]]; then
    git worktree add -b "$local_branch" "$target" "origin/$local_branch"
  else
    git worktree add "$target" "$local_branch"
  fi
  echo "✓ Worktree ready at: $target (branch $local_branch)"
  cd "$target" && exec "${SHELL:-/bin/bash}"
}

cmd_switch() { # $1=partial
  [[ -n "$1" ]] || { echo "✖ Partial branch name required"; exit 1; }
  local matches=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && matches+=("$line")
  done < <(find_matching_worktrees "$1")
  case ${#matches[@]} in
    0) echo "✖ No worktree found matching '$1'"; exit 1 ;;
    1) cd "${matches[0]}" && exec "${SHELL:-/bin/bash}" ;;
    *) echo "Multiple matches found:"; select m in "${matches[@]}"; do [[ -n "$m" ]] && { cd "$m" && exec "${SHELL:-/bin/bash}"; }; done ;;
  esac
}

# ---------- argument parsing ------------------------------------------------
[[ $# -eq 0 ]] && { usage; exit 1; }
cmd="${1}"; shift
force=false; positional=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) force=true ;;
    -*)         echo "Unknown option: $1"; usage; exit 1 ;;
    *)          positional+=("$1") ;;
  esac; shift
done
arg="${positional[0]:-}"; arg2="${positional[1]:-}"

# ---------- command dispatch -----------------------------------------------
case "$cmd" in
  list|ls)                 list_worktrees ;;
  du)                      disk_usage ;;
  create|new)              create_or_checkout "create" "$arg" "$force" ;;
  checkout|co)             cmd_checkout "$arg" ;;
  switch|sw)               cmd_switch "$arg" ;;
  tag|label)               cmd_tag "$arg" "$arg2" ;;
  switchg|sg)              cmd_switchg "$arg" ;;
  time|tm)                 cmd_time "$arg" ;;
  delete|remove|rm)        delete_worktree "$arg" "$force" ;;
  push)                    commit_and_push ;;
  help|-h|--help)          usage ;;
  *)                       echo "Unknown command: $cmd"; usage; exit 1 ;;
esac
