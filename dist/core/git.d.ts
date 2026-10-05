export interface RunOptions {
    cwd?: string;
    allowFailure?: boolean;
    stdin?: "inherit" | "ignore";
}
export interface RunResult {
    stdout: string;
    stderr: string;
    status: number;
}
export declare function run(command: string, args: string[], options?: RunOptions): RunResult;
export declare function git(args: string[], cwd?: string, allowFailure?: boolean): RunResult;
/** Raw Git output for machine formats where trailing NUL/newlines are data. */
export declare function gitRaw(args: string[], cwd?: string, allowFailure?: boolean): RunResult;
export declare function gitOk(args: string[], cwd?: string): boolean;
export declare function gitText(args: string[], cwd?: string): string;
export declare function optionalGitText(args: string[], cwd?: string): string | undefined;
export declare function requireRepository(cwd?: string): string;
export declare function branchAt(cwd: string): string;
export declare function hasChanges(cwd: string): boolean;
