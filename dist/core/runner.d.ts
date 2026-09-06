export interface GitRunRequest {
    args: readonly string[];
    cwd: string;
    stdin?: "ignore" | "inherit";
}
export interface GitRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export interface GitRunner {
    run(request: GitRunRequest): GitRunResult;
}
export declare class SystemGitRunner implements GitRunner {
    run(request: GitRunRequest): GitRunResult;
}
