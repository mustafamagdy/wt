import type { WorktreeRecord } from "./model.js";

/** Details attached to a malformed porcelain record. */
export class WorktreePorcelainParseError extends Error {
  readonly recordIndex: number;
  readonly field?: string;

  constructor(message: string, recordIndex: number, field?: string) {
    super(`Invalid git worktree porcelain record ${recordIndex}${field ? ` (${field})` : ""}: ${message}`);
    this.name = "WorktreePorcelainParseError";
    this.recordIndex = recordIndex;
    this.field = field;
  }
}

/**
 * Parse the exact output of `git worktree list --porcelain -z`.
 *
 * NUL is the only separator used here. Paths therefore remain safe when they
 * contain spaces, tabs, newlines, or Unicode characters.
 */
export function parseWorktreePorcelain(output: string): WorktreeRecord[] {
  if (output.length === 0) return [];

  const records = output.split("\0\0");
  // Git terminates the stream with a record separator. Do not expose a fake
  // empty record when callers pass the raw command output.
  if (records.at(-1) === "") records.pop();

  return records.map((record, index) => parseRecord(record, index));
}

/** Compatibility spelling for callers that include `list` in the function name. */
export const parseWorktreeListPorcelain = parseWorktreePorcelain;

function parseRecord(record: string, recordIndex: number): WorktreeRecord {
  const fields = record.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length === 0 || fields[0] === "") {
    throw new WorktreePorcelainParseError("record is empty", recordIndex);
  }

  const pathField = consumeRequired(fields, "worktree ", recordIndex, "worktree");
  const path = pathField.slice("worktree ".length);
  if (path.length === 0) throw new WorktreePorcelainParseError("path is empty", recordIndex, "worktree");

  const headField = consumeRequired(fields, "HEAD ", recordIndex, "HEAD");
  const head = headField.slice("HEAD ".length);
  if (head.length === 0 || /\s/.test(head)) {
    throw new WorktreePorcelainParseError("object ID is empty or contains whitespace", recordIndex, "HEAD");
  }

  const result: WorktreeRecord = {
    path,
    head,
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
  };

  for (const field of fields) {
    if (field === "") continue;
    if (field.startsWith("branch ")) {
      if (result.branch !== undefined || result.detached) duplicate(field, recordIndex);
      const branch = field.slice("branch ".length);
      if (!branch) throw new WorktreePorcelainParseError("branch ref is empty", recordIndex, "branch");
      result.branch = branch;
    } else if (field === "detached") {
      if (result.detached || result.branch !== undefined) duplicate(field, recordIndex);
      result.detached = true;
    } else if (field === "bare") {
      if (result.bare) duplicate(field, recordIndex);
      result.bare = true;
    } else if (field === "locked" || field.startsWith("locked ")) {
      if (result.locked) duplicate(field, recordIndex);
      result.locked = true;
      const reason = field.length === "locked".length ? undefined : field.slice("locked".length + 1);
      if (reason) result.lockReason = reason;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      if (result.prunable) duplicate(field, recordIndex);
      result.prunable = true;
      const reason = field.length === "prunable".length ? undefined : field.slice("prunable".length + 1);
      if (reason) result.pruneReason = reason;
    } else {
      throw new WorktreePorcelainParseError(`unknown field ${JSON.stringify(field)}`, recordIndex);
    }
  }

  return result;
}

function consumeRequired(fields: string[], prefix: string, recordIndex: number, name: string): string {
  const field = fields.shift();
  if (field === undefined || !field.startsWith(prefix)) {
    throw new WorktreePorcelainParseError(`expected ${name} field`, recordIndex, name);
  }
  return field;
}

function duplicate(field: string, recordIndex: number): never {
  throw new WorktreePorcelainParseError(`duplicate field ${JSON.stringify(field)}`, recordIndex);
}
