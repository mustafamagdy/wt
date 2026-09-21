import * as p from "@clack/prompts";
import type { Option } from "@clack/prompts";
import pc from "picocolors";
import { CliError } from "./errors.js";

export const color = pc;

export const ui = {
  success(message: string): void {
    p.log.success(message);
  },
  info(message: string): void {
    p.log.info(message);
  },
  warning(message: string): void {
    p.log.warn(message);
  },
  error(message: string): void {
    console.error(`${pc.red("✖")} ${message}`);
  },
};

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    throw new CliError("Cancelled.", 130);
  }
  return value as T;
}

export async function confirm(message: string, initialValue = false): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  return unwrap(await p.confirm({ message, initialValue }));
}

/** Type-to-filter single choice; matches label and hint. */
export async function search<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>,
  initialUserInput?: string,
): Promise<T> {
  if (!process.stdin.isTTY) throw new CliError(`${message} Pass a more specific value in non-interactive mode.`);
  return unwrap(await p.autocomplete({
    message,
    options: options.map((option) => (option.hint === undefined
      ? { value: option.value, label: option.label }
      : { value: option.value, label: option.label, hint: option.hint }) as Option<T>),
    maxItems: 12,
    placeholder: "type to filter",
    ...(initialUserInput ? { initialUserInput } : {}),
    filter: (term, option) => `${option.label ?? ""} ${option.hint ?? ""}`.toLowerCase().includes(term.toLowerCase()),
  }));
}

export async function chooseMany<T extends string>(
  message: string,
  groups: Record<string, Array<{ value: T; label: string; hint?: string }>>,
  initialValues: T[],
): Promise<T[]> {
  if (!process.stdin.isTTY) throw new CliError(`${message} Interactive selection needs a terminal.`);
  const options = Object.fromEntries(Object.entries(groups).map(([group, items]) => [
    group,
    items.map((item) => (item.hint === undefined
      ? { value: item.value, label: item.label }
      : { value: item.value, label: item.label, hint: item.hint }) as Option<T>),
  ]));
  return unwrap(await p.groupMultiselect({ message, options, initialValues, required: false, groupSpacing: 1 }));
}

export function spinner(): { start(message: string): void; stop(message: string): void } {
  if (!process.stdout.isTTY) return { start: (message) => ui.info(message), stop: () => {} };
  const spin = p.spinner();
  return { start: (message) => spin.start(message), stop: (message) => spin.stop(message) };
}

export async function input(message: string, placeholder?: string): Promise<string> {
  if (!process.stdin.isTTY) throw new CliError(`${message} Input is required in non-interactive mode.`);
  return (unwrap(
    await p.text({
      message,
      ...(placeholder ? { placeholder } : {}),
      validate(value) {
        if (!value?.trim()) return "A value is required.";
      },
    }),
  ) ?? "").trim();
}

export function heading(title: string): void {
  console.log(`\n${pc.bold(pc.cyan(title))}`);
}

export function renderTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? "").length)),
  );
  const format = (row: string[]) =>
    row.map((cell, index) => `${cell}${" ".repeat(Math.max(0, (widths[index] ?? 0) - stripAnsi(cell).length))}`).join("  ");
  console.log(pc.bold(format(headers)));
  console.log(pc.dim(widths.map((width) => "─".repeat(width)).join("  ")));
  for (const row of rows) console.log(format(row));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
