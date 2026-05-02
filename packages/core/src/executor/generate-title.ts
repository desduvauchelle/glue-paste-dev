import { getFreshEnv } from "./fresh-env.js";
import { log } from "../logger.js";

/**
 * Uses Claude CLI to generate a short title from a card description.
 * Returns empty string on failure so callers can gracefully degrade.
 */
export async function generateTitle(description: string): Promise<string> {
  const trimmed = description.trim();
  if (!trimmed) return "";

  const prompt = `Generate a very short title (2-5 words) for this task. Reply with ONLY the title text, no quotes, no explanation, no punctuation at the end.\n\n${trimmed.slice(0, 1000)}`;

  try {
    const proc = Bun.spawn(
      ["claude", "-p", prompt, "--output-format", "text", "--max-turns", "2", "--model", "claude-haiku-4-5-20251001"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: getFreshEnv(),
      }
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log.warn("generate-title", `CLI exited with code ${exitCode}`);
      return "";
    }

    const title = output.trim().replace(/^["']|["']$/g, "").slice(0, 200);

    if (/reached max turns|error:/i.test(title)) {
      log.warn("generate-title", `Rejected suspicious output: "${title}"`);
      return "";
    }

    log.debug("generate-title", `Generated: "${title}"`);
    return title;
  } catch (err) {
    log.warn("generate-title", "Failed to generate title:", err);
    return "";
  }
}
