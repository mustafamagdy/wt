/** A single entry in Git's worktree registry. */
export interface WorktreeRecord {
  /** Absolute (or Git-reported) worktree path. */
  path: string;
  /** Object ID currently checked out in the worktree. */
  head: string;
  /** Branch ref, when this worktree is attached to a branch. */
  branch?: string;
  /** True when Git reports the worktree as detached. */
  detached: boolean;
  /** True for the main bare repository entry. */
  bare: boolean;
  /** True when the worktree is locked. */
  locked: boolean;
  /** Optional text supplied after the `locked` marker. */
  lockReason?: string;
  /** True when Git reports the worktree as prunable. */
  prunable: boolean;
  /** Optional text supplied after the `prunable` marker. */
  pruneReason?: string;
}
