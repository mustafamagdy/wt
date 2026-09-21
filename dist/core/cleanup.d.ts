import type { WorktreeRecord } from "./model.js";
import { type AsyncGitRunner } from "./runner.js";
/** Why a worktree can be removed without losing commits or local edits. */
export type CleanReason = "merged" | "squash-merged" | "pushed" | "missing";
/** Why a worktree must stay. */
export type KeepReason = "primary" | "bare" | "locked" | "current" | "dirty" | "unpushed" | "error";
export type CleanVerdict = {
    removable: true;
    reason: CleanReason;
} | {
    removable: false;
    reason: KeepReason;
    detail?: string;
};
export interface CleanCandidate {
    /** Absolute common Git directory; the repository identity. */
    repository: string;
    /** Human-friendly repository name for grouping. */
    repositoryName: string;
    worktree: WorktreeRecord;
    /** Short branch name, when the worktree is attached to a branch. */
    branch?: string;
    verdict: CleanVerdict;
}
export interface AnalyzeCleanupOptions {
    /** Any paths inside the repositories to inspect. Duplicates are collapsed. */
    paths: readonly string[];
    /** Only inspect registrations under this directory. All registrations when omitted. */
    within?: string;
    /** Run `git fetch --all --prune` once per repository first. Default true. */
    fetch?: boolean;
    /** Worktree containing the caller's cwd; never removed. */
    currentPath?: string;
    concurrency?: number;
    runner?: AsyncGitRunner;
    /** Called when a repository fetch fails; analysis continues with local refs. */
    onFetchError?: (repository: string, message: string) => void;
}
export interface CleanupResult {
    candidate: CleanCandidate;
    ok: boolean;
    error?: string;
    branchDeleted?: boolean;
}
export interface ExecuteCleanupOptions {
    deleteBranch?: boolean;
    concurrency?: number;
    runner?: AsyncGitRunner;
}
/** Classify worktrees as removable or not. All Git calls run concurrently, bounded by `concurrency`. */
export declare function analyzeCleanup(options: AnalyzeCleanupOptions): Promise<CleanCandidate[]>;
/**
 * Remove the chosen worktrees in parallel. Missing registrations are pruned,
 * and branch deletion runs once per repository to avoid ref lock contention.
 */
export declare function executeCleanup(candidates: readonly CleanCandidate[], options?: ExecuteCleanupOptions): Promise<CleanupResult[]>;
