#!/usr/bin/env bun

import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { restart } from "./commands/restart.js";
import { status } from "./commands/status.js";
import { logs } from "./commands/logs.js";
import { open } from "./commands/open.js";
import { update } from "./commands/update.js";
import { uninstall } from "./commands/uninstall.js";
import { add } from "./commands/add.js";

export async function route(command: string | undefined, flags: string[]) {
  switch (command) {
    case "up":
    case "start":
      await start();
      break;
    case "down":
    case "stop":
      await stop();
      break;
    case "restart":
      await restart();
      break;
    case "status":
      await status(flags);
      break;
    case "logs":
      await logs(flags.includes("-f") || flags.includes("--follow"));
      break;
    case "open":
      await open();
      break;
    case "update":
      await update();
      break;
    case "uninstall":
      await uninstall(flags);
      break;
    case "add":
      await add(flags);
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(`
\x1b[1mGluePasteDev\x1b[0m — AI-powered Kanban for automated coding

\x1b[2mUsage:\x1b[0m
  glue-paste-dev <command> [flags]

\x1b[2mDaemon:\x1b[0m
  up, start      Start the daemon (auto-restarts on crash)
  down, stop     Stop the daemon gracefully
  restart        Stop + start
  status         Show daemon health, PID, board count

\x1b[2mDashboard:\x1b[0m
  open           Open the dashboard in your browser (starts daemon if needed)
  logs [-f]      Show daemon logs (-f to follow)

\x1b[2mCards:\x1b[0m
  add            Create a card in a project

\x1b[2mMaintenance:\x1b[0m
  update         Check for updates and install if available
  uninstall      Remove GluePasteDev (--yes to confirm, --keep-data to back up DB)

\x1b[2mMachine-readable output:\x1b[0m
  Most commands accept --json for machine-readable JSON output.
  Use this when calling from other CLI tools (Copilot, Claude, Cursor, etc.)

\x1b[2mExamples:\x1b[0m
  glue-paste-dev up          # start daemon, open browser
  glue-paste-dev status      # check if running
  glue-paste-dev logs -f     # tail logs
  glue-paste-dev down        # stop

  glue-paste-dev add "Fix login bug" -p my-project
  glue-paste-dev add "Add tests" -p app --status queued
  glue-paste-dev add "Refactor auth" -p app --plan-thinking basic --auto-commit

  # Machine-readable output for external tools
  glue-paste-dev status --json
  glue-paste-dev add "Fix bug" -p app --json
`);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "glue-paste-dev --help" for usage.');
      process.exit(1);
  }
}

const command = process.argv[2];
const flags = process.argv.slice(3);
await route(command, flags);
