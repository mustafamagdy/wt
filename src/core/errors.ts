export class GitWorktreeError extends Error {
  readonly code: string;
  readonly command?: readonly string[];
  readonly exitCode?: number;

  constructor(message: string, options: { code: string; command?: readonly string[]; exitCode?: number; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitWorktreeError";
    this.code = options.code;
    this.command = options.command;
    this.exitCode = options.exitCode;
  }
}
