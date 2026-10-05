import { type AsyncGitRunner } from "./runner.js";
import { type Worktree } from "./worktrees.js";
export interface CopyResult {
    pattern: string;
    /** Files or directories copied for this pattern; 0 when nothing matched. */
    count: number;
}
export interface CreateWorktreeOptions {
    /** Any path inside the source repository. Defaults to the process cwd. */
    cwd?: string;
    /** Managed worktree directory. */
    root: string;
    branch: string;
    /** Local or origin branch to start from. Current HEAD when omitted. */
    base?: string;
    /** Replace an existing registered worktree at the target path. */
    force?: boolean;
    /** File or glob patterns, relative to the repository, to copy into the new worktree. */
    copy?: readonly string[];
}
export interface CreateWorktreeResult {
    path: string;
    branch: string;
    repository: string;
    /** Ref the branch was created from, when a base was given. */
    startPoint?: string;
    copied: CopyResult[];
}
export declare function repositoryRoot(cwd?: string): string;
export declare function currentBranch(cwd?: string): string;
export declare function createWorktree(options: CreateWorktreeOptions): CreateWorktreeResult;
/** Copy matching untracked files or directories from a repository into a worktree. */
export declare function copyIntoWorktree(repository: string, target: string, patterns: readonly string[]): CopyResult[];
export interface CheckoutWorktreeOptions {
    cwd?: string;
    root: string;
    branch: string;
    force?: boolean;
}
export interface CheckoutWorktreeResult {
    path: string;
    branch: string;
    /** True when a matching worktree already existed and nothing changed. */
    reused: boolean;
    /** True when the branch only existed on origin and a local tracking branch was created. */
    fromOrigin: boolean;
}
export declare function checkoutWorktree(options: CheckoutWorktreeOptions): CheckoutWorktreeResult;
export interface TimeWorktreeOptions {
    cwd?: string;
    root: string;
    branch: string;
    /** YYYY-MM-DD; the worktree checks out the last commit on or before this day. */
    date: string;
    force?: boolean;
}
export interface TimeWorktreeResult {
    path: string;
    branch: string;
    date: string;
    commit: string;
}
export declare function timeWorktree(options: TimeWorktreeOptions): TimeWorktreeResult;
/**
 * Worktrees in the managed directory chosen by a selector. An exact branch,
 * folder name, or path wins; otherwise branches containing the selector
 * (case-insensitive) match. Callers decide what to do with several matches.
 */
export declare function selectWorktrees(root: string, selector: string): Worktree[];
export interface WorktreeStatus {
    path: string;
    branch: string;
    upstream?: string;
    /** Commits not on the upstream; absent when there is no upstream. */
    ahead?: number;
    /** Upstream commits not in the worktree; absent when there is no upstream. */
    behind?: number;
    dirty: boolean;
    /** Changed or untracked paths. */
    changes: number;
    /** Bytes on disk, only when requested. */
    size?: number;
}
/** Facts needed before removing or syncing a worktree. */
export declare function inspectWorktree(path: string, options?: {
    size?: boolean;
}): WorktreeStatus;
/** Remove one registered worktree. Its branch is kept. Refuses uncommitted changes unless `force`. */
export declare function removeWorktree(path: string, options?: {
    force?: boolean;
}): {
    path: string;
};
export interface RemoveResult {
    path: string;
    ok: boolean;
    error?: string;
}
/** Remove several worktrees in parallel; failures are reported per worktree, not thrown. */
export declare function removeWorktrees(paths: readonly string[], options?: {
    force?: boolean;
    runner?: AsyncGitRunner;
}): Promise<RemoveResult[]>;
/** Unpushed commit counts for worktrees with an upstream, checked in parallel. */
export declare function unpushedCounts(items: readonly Worktree[], runner?: AsyncGitRunner): Promise<Map<string, number>>;
export type SyncStep = "fetch" | "stash" | "rebase" | "merge";
export interface SyncResult {
    path: string;
    branch: string;
    /** Branch synced onto, such as `origin/main`. */
    target: string;
    fetched: boolean;
    method: "rebase" | "merge";
    stashed: boolean;
    /** False when stashed changes could not be restored and remain in the stash. */
    stashRestored: boolean;
}
/**
 * Rebase a worktree onto origin/main (or master, or the local equivalents),
 * falling back to a merge, while stashing and restoring local changes.
 */
export declare function syncWorktree(path: string, options?: {
    onStep?: (step: SyncStep, detail: string) => void;
}): SyncResult;
export declare function readTags(path: string): string[];
/** Add a tag to a worktree. Adding a tag it already has changes nothing. */
export declare function addTag(path: string, tag: string): {
    tags: string[];
    added: boolean;
};
/** Every tag in the managed directory with the number of worktrees carrying it. */
export declare function tagCounts(root: string): Map<string, number>;
export declare function worktreesWithTag(root: string, tag: string): string[];
/** Bytes used by each managed worktree, largest first. */
export declare function diskUsage(root: string): Array<{
    path: string;
    size: number;
}>;
export interface PushOptions {
    cwd?: string;
    /** Commit message; required when there are uncommitted changes. */
    message?: string;
    /** Added as `origin` when the repository has no origin remote. */
    originUrl?: string;
}
export interface PushResult {
    branch: string;
    committed: boolean;
    originAdded: boolean;
}
/** Stage everything, commit when needed, and push the current branch to origin. */
export declare function commitAndPush(options?: PushOptions): PushResult;
export declare function originUrl(cwd?: string): string | undefined;
export declare function hasUncommittedChanges(cwd?: string): boolean;
