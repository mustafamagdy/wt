import type { WorktreeRecord } from "./model.js";
/** Details attached to a malformed porcelain record. */
export declare class WorktreePorcelainParseError extends Error {
    readonly recordIndex: number;
    readonly field?: string;
    constructor(message: string, recordIndex: number, field?: string);
}
/**
 * Parse the exact output of `git worktree list --porcelain -z`.
 *
 * NUL is the only separator used here. Paths therefore remain safe when they
 * contain spaces, tabs, newlines, or Unicode characters.
 */
export declare function parseWorktreePorcelain(output: string): WorktreeRecord[];
/** Compatibility spelling for callers that include `list` in the function name. */
export declare const parseWorktreeListPorcelain: typeof parseWorktreePorcelain;
