import type { WorktreeRecord } from "./model.js";
import { type GitRunner } from "./runner.js";
export interface MutationResult {
    before: readonly WorktreeRecord[];
    after: readonly WorktreeRecord[];
}
export interface AddWorktreeOptions {
    path: string;
    branch?: string;
    startPoint?: string;
    detach?: boolean;
    force?: boolean;
    lock?: boolean;
    lockReason?: string;
}
export interface RemoveWorktreeOptions {
    force?: boolean;
}
/** Exact, injectable API over one Git repository's worktree registry. */
export declare class WorktreeManager {
    readonly cwd: string;
    readonly runner: GitRunner;
    constructor(options?: {
        cwd?: string;
        runner?: GitRunner;
    });
    list(): WorktreeRecord[];
    getByPath(path: string): WorktreeRecord | undefined;
    getByBranch(branch: string): WorktreeRecord | undefined;
    add(options: AddWorktreeOptions): MutationResult;
    remove(path: string, options?: RemoveWorktreeOptions): MutationResult;
    move(path: string, destination: string, force?: boolean): MutationResult;
    lock(path: string, reason?: string): MutationResult;
    unlock(path: string): MutationResult;
    repair(paths?: readonly string[]): MutationResult;
    prune(options?: {
        dryRun?: boolean;
        verbose?: boolean;
        expire?: string;
    }): MutationResult;
    private simpleMutation;
    private requireExactPath;
    private git;
}
