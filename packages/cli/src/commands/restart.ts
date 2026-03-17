import { stop } from "./stop.js";
import { start } from "./start.js";

export async function restart() {
  await stop();
  await start({ open: false });
}
