import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { worktreesDirectory } from "./config.js";
import {
  checkoutCommand,
  createCommand,
  deleteCommand,
  duCommand,
  listCommand,
  pushCommand,
  switchCommand,
  switchGroupCommand,
  syncCommand,
  tagCommand,
  timeCommand,
} from "./commands.js";
import { CliError } from "./errors.js";
import { color, ui } from "./ui.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const program = new Command();

program
  .name("wt")
  .description("A fast, polished Git worktree manager")
  .version(packageJson.version)
  .showHelpAfterError("Run 'wt --help' for usage.")
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    subcommandTerm: (command) => `${color.cyan(command.name())} ${command.usage()}`,
  })
  .exitOverride();

const directoryOption = ["-d, --dir <path>", "managed worktree directory", worktreesDirectory()] as const;

program
  .command("list [pattern]")
  .aliases(["ls", "l"])
  .description("list managed worktrees")
  .option("--current", "show every worktree registered to the current repository")
  .option(...directoryOption)
  .action(listCommand);

program
  .command("create <branch> [base]")
  .alias("new")
  .description("create a branch and worktree")
  .option("-f, --force", "replace an existing target directory")
  .option("--copy <patterns>", "comma-separated file or glob patterns to copy")
  .option("--no-shell", "do not open an interactive shell in the worktree")
  .option(...directoryOption)
  .action(createCommand);

program
  .command("checkout <branch>")
  .alias("co")
  .description("check out an existing branch in a worktree")
  .option("-f, --force", "replace a stale target directory")
  .option("--no-shell", "do not open an interactive shell in the worktree")
  .option(...directoryOption)
  .action(checkoutCommand);

program
  .command("switch <partial>")
  .alias("sw")
  .description("open a worktree by partial branch name")
  .option(...directoryOption)
  .action(switchCommand);

program
  .command("delete <partial>")
  .aliases(["remove", "rm"])
  .description("remove a managed worktree")
  .option("-f, --force", "remove even when the worktree is dirty")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--dry-run", "show what would be removed")
  .option(...directoryOption)
  .action(deleteCommand);

program
  .command("sync [partial]")
  .description("rebase a worktree onto origin/main with safe stash handling")
  .option("-y, --yes", "confirm syncing the current branch")
  .option(...directoryOption)
  .action(syncCommand);

program
  .command("push")
  .description("commit pending changes and push the current branch")
  .option("-m, --message <message>", "commit message")
  .action(pushCommand);

program
  .command("tag <partial> <tag>")
  .alias("label")
  .description("tag a managed worktree")
  .option(...directoryOption)
  .action(tagCommand);

program
  .command("switch-group <tag>")
  .aliases(["switchg", "sg"])
  .description("open a worktree by tag")
  .option(...directoryOption)
  .action(switchGroupCommand);

program
  .command("time <branch@date>")
  .alias("tm")
  .description("create a detached worktree at the last commit before a date")
  .option("-f, --force", "replace an existing target directory")
  .option("--no-shell", "do not open an interactive shell in the worktree")
  .option(...directoryOption)
  .action(timeCommand);

program
  .command("du")
  .description("show disk usage for managed worktrees")
  .option(...directoryOption)
  .action(duCommand);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (["commander.helpDisplayed", "commander.version"].includes(error.code)) return;
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof CliError) {
      if (error.exitCode !== 130) ui.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    ui.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
