import { PORT, getDaemonStatus } from "../daemon.js";

interface AddOptions {
  description: string;
  project: string;
  status?: "todo" | "queued" | undefined;
  planThinking?: "smart" | "basic" | "none" | null | undefined;
  executeThinking?: "smart" | "basic" | null | undefined;
  autoCommit?: boolean | null | undefined;
  autoPush?: boolean | null | undefined;
  json?: boolean;
}

export function parseFlags(flags: string[]): AddOptions {
  let description = "";
  let project = "";
  let status: "todo" | "queued" | undefined;
  let planThinking: "smart" | "basic" | "none" | null | undefined;
  let executeThinking: "smart" | "basic" | null | undefined;
  let autoCommit: boolean | null | undefined;
  let autoPush: boolean | null | undefined;
  let json = false;

  const positional: string[] = [];

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;

    if (flag === "--json") {
      json = true;
    } else if (flag === "--project" || flag === "-p") {
      project = flags[++i] || "";
    } else if (flag === "--status" || flag === "-s") {
      const val = flags[++i];
      if (val !== "todo" && val !== "queued") {
        console.error(`Invalid status: ${val}. Must be "todo" or "queued".`);
        process.exit(1);
      }
      status = val;
    } else if (flag === "--plan-thinking") {
      const val = flags[++i];
      if (val !== "smart" && val !== "basic" && val !== "none") {
        console.error(`Invalid plan-thinking: ${val}. Must be "smart", "basic", or "none".`);
        process.exit(1);
      }
      planThinking = val;
    } else if (flag === "--execute-thinking") {
      const val = flags[++i];
      if (val !== "smart" && val !== "basic") {
        console.error(`Invalid execute-thinking: ${val}. Must be "smart" or "basic".`);
        process.exit(1);
      }
      executeThinking = val;
    } else if (flag === "--auto-commit") {
      autoCommit = true;
    } else if (flag === "--no-auto-commit") {
      autoCommit = false;
    } else if (flag === "--auto-push") {
      autoPush = true;
    } else if (flag === "--no-auto-push") {
      autoPush = false;
    } else if (!flag.startsWith("-")) {
      positional.push(flag);
    } else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }

  description = positional.join(" ");

  if (!description) {
    if (json) {
      console.error(JSON.stringify({ error: "Missing description", usage: 'glue-paste-dev add "description" --project <slug>' }));
    } else {
      console.error("Missing description. Usage: glue-paste-dev add \"description\" --project <slug>");
    }
    process.exit(1);
  }

  if (!project) {
    if (json) {
      console.error(JSON.stringify({ error: "Missing --project (-p) flag", usage: 'glue-paste-dev add "description" --project <slug>' }));
    } else {
      console.error("Missing --project (-p) flag. Usage: glue-paste-dev add \"description\" --project <slug>");
    }
    process.exit(1);
  }

  return {
    description,
    project,
    status,
    planThinking,
    executeThinking,
    autoCommit,
    autoPush,
    json,
  };
}

interface Board {
  id: string;
  name: string;
  slug: string | null;
}

export async function add(flags: string[]) {
  const opts = parseFlags(flags);

  const jsonOut = opts.json;

  const { running } = getDaemonStatus();
  if (!running) {
    if (jsonOut) {
      console.error(JSON.stringify({ error: "Daemon is not running", hint: "glue-paste-dev up" }));
    } else {
      console.error("Daemon is not running. Start it first with: glue-paste-dev up");
    }
    process.exit(1);
  }

  // Look up board by slug
  let boards: Board[];
  try {
    const res = await fetch(`http://localhost:${PORT}/api/boards`);
    if (!res.ok) {
      if (jsonOut) {
        console.error(JSON.stringify({ error: "Failed to fetch boards", status: res.status }));
      } else {
        console.error(`Failed to fetch boards: ${res.status} ${res.statusText}`);
      }
      process.exit(1);
    }
    boards = (await res.json()) as Board[];
  } catch {
    if (jsonOut) {
      console.error(JSON.stringify({ error: "Could not connect to daemon" }));
    } else {
      console.error("Could not connect to daemon. Is it running?");
    }
    process.exit(1);
  }

  const board = boards.find((b) => b.slug === opts.project);
  if (!board) {
    const available = boards
      .filter((b) => b.slug)
      .map((b) => ({ slug: b.slug, name: b.name }));
    if (jsonOut) {
      console.error(JSON.stringify({ error: `No project found with slug "${opts.project}"`, available }));
    } else {
      const availableStr = available.map((b) => `  ${b.slug} (${b.name})`).join("\n");
      console.error(`No project found with slug "${opts.project}".`);
      if (availableStr) {
        console.error(`Available projects:\n${availableStr}`);
      } else {
        console.error("No projects have slugs set. Set a slug in the project settings.");
      }
    }
    process.exit(1);
  }

  // Build card payload
  const payload: Record<string, unknown> = {
    description: opts.description,
    status: opts.status ?? "todo",
    blocking: true,
  };

  if (opts.planThinking !== undefined) {
    payload.plan_thinking = opts.planThinking === "none" ? null : opts.planThinking;
  }
  if (opts.executeThinking !== undefined) {
    payload.execute_thinking = opts.executeThinking;
  }
  if (opts.autoCommit !== undefined) {
    payload.auto_commit = opts.autoCommit;
  }
  if (opts.autoPush !== undefined) {
    payload.auto_push = opts.autoPush;
  }

  // Create the card
  try {
    const res = await fetch(`http://localhost:${PORT}/api/cards/board/${board.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      if (jsonOut) {
        console.error(JSON.stringify({ error: "Failed to create card", status: res.status, details: err }));
      } else {
        console.error(`Failed to create card: ${res.status} ${res.statusText}`);
        if (err) console.error(JSON.stringify(err, null, 2));
      }
      process.exit(1);
    }

    const card = (await res.json()) as { id: string; status: string };
    if (jsonOut) {
      console.log(JSON.stringify({ ok: true, id: card.id, status: card.status, board: board.name, description: opts.description }));
    } else {
      console.log(`Card created in \x1b[1m${board.name}\x1b[0m (${card.status})`);
      console.log(`  ID: ${card.id}`);
      console.log(`  ${opts.description}`);
    }
  } catch {
    if (jsonOut) {
      console.error(JSON.stringify({ error: "Could not connect to daemon" }));
    } else {
      console.error("Failed to create card. Could not connect to daemon.");
    }
    process.exit(1);
  }
}
