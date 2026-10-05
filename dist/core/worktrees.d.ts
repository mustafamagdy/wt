export interface Worktree {
    path: string;
    branch: string;
    head?: string;
    detached: boolean;
    prunable: boolean;
    project: string;
    upstream?: string;
    dirty: boolean;
}
export declare function registeredWorktreePaths(cwd?: string): string[];
export declare function managedWorktreePaths(root: string): string[];
export declare function repositoryName(cwd: string): string;
export declare function describeWorktree(path: string, projectOverride?: string): Worktree | undefined;
export declare function listWorktrees(options: {
    root: string;
    current: boolean;
    pattern?: string;
    cwd?: string;
}): Worktree[];
export declare function findManagedWorktrees(root: string, partial: string): Worktree[];
export declare function branchExists(branch: string, cwd: string): {
    local: boolean;
    remote: boolean;
};
export declare function directorySize(path: string): number;
export declare function formatBytes(bytes: number): string;
