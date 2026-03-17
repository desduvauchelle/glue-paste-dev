#!/usr/bin/env bun

import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { restart } from "./commands/restart.js";
import { status } from "./commands/status.js";
import { logs } from "./commands/logs.js";
import { open } from "./commands/open.js";
import { update } from "./commands/update.js";
import { uninstall } from "./commands/uninstall.js";

const command = process.argv[2];
const flags = process.argv.slice(3);

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
    await status();
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

\x1b[2mMaintenance:\x1b[0m
  update         Check for updates and install if available
  uninstall      Remove GluePasteDev (--yes to confirm, --keep-data to back up DB)

\x1b[2mExamples:\x1b[0m
  glue-paste-dev up          # start daemon, open browser
  glue-paste-dev status      # check if running
  glue-paste-dev logs -f     # tail logs
  glue-paste-dev down        # stop
`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "glue-paste-dev --help" for usage.');
    process.exit(1);
}
