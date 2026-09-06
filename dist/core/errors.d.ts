export declare class GitWorktreeError extends Error {
    readonly code: string;
    readonly command?: readonly string[];
    readonly exitCode?: number;
    constructor(message: string, options: {
        code: string;
        command?: readonly string[];
        exitCode?: number;
        cause?: unknown;
    });
}
