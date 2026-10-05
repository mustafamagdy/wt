import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function worktreesDirectory(override?: string): string {
  const configured = override ?? process.env.WT_WORKTREES_DIR ?? resolve(homedir(), ".worktrees");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function folderFromBranch(branch: string): string {
  return branch.replaceAll("/", "-");
}

