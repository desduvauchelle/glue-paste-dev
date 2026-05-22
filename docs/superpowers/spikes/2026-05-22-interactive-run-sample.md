# Interactive-run spike findings (2026-05-22)

Driver: `claude` 2.1.85 (Claude Code) in a Bun PTY (`Bun.spawn(["claude"], { terminal })`), cwd a fresh `/tmp/p2` git repo, env from `getFreshEnv()`. Two runs captured to `/tmp/p2-capture.{raw,log}`.

## 1. Prompt delivery — SOLVED ✅

A multi-line prompt sent as **bracketed paste** arrives as ONE message/turn:
```
term.write("\x1b[200~" + multiLinePrompt + "\x1b[201~");
await sleep(300);
term.write("\r");   // submit
```
Observed: claude showed "Pasting text…" then the full 3-line prompt as a single input, submitted as one turn ("Propagating…"). Embedded `\n` did NOT submit early. Use this for `OpenOptions.initialInput` delivery.

## 2. Trust-folder prompt (first run in a new dir)

```
Quick safety check: Is this a project you created or one you trust?
❯ 1. Yes, I trust this folder
  2. No, exit
```
Accepted with **Enter (`\r`)** → "✔". This PROVES PTY keystrokes reach claude's menus and **Enter selects the highlighted (`❯`) option**.

## 3. Permission prompt — real format

```
⏺ Write(hello.txt)  Create file hello.txt
  1 hi
  2 bye
Do you want to create hello.txt?
❯ 1. Yes
  2. Yes, allow all edits during this session (shift+tab)
  3. No
Esc to cancel · Tab to amend
```
- Prompt text varies by action: "Do you want to create/edit/…?". Default highlighted = `❯ 1. Yes`.
- **Accept = Enter (`\r`)** (selects highlighted Yes), same as the trust prompt. NOT `"1\r"`.

## 4. CRITICAL — TUI renders words WITHOUT spaces

claude's TUI repaints via cursor positioning; after ANSI-stripping, words are **jammed together**: the prompt appears as `Doyouwanttocreatehello.txt?` and idle as `❯Try"create..."`. 
**Consequence:** any detector MUST strip ALL whitespace before matching. Match `/doyouwantto/i` (or `text.replace(/\s+/g,"")` then match), NOT `/Do you want to/`.

This is why the existing **Phase 1 `permission-detector.ts` is broken**: its pattern `/Do you want to proceed\?[\s\S]*1\.\s*Yes/i` (spaces + "proceed?") never matches real output, and its `acceptInput = "1\r"` is wrong. Fix: whitespace-insensitive pattern like `/doyouwantto/i` (or detect the `❯1.Yes`/`1.Yes` menu) + `acceptInput = "\r"`.

## 5. Idle / turn-complete indicator

Ready/idle = the input box line: `❯ Try "create a util logging.py that..."` (placeholder) or `❯ ` empty. Whitespace-stripped: `❯Try"..."` or a lone `❯`. Working = spinner glyphs cycling (`✻✽✶✳✢·`) + OSC window-title updates (`\x1b]0;⠂ <task>\x07`). 
NOTE: a clean post-turn idle was not captured because both runs stalled at the permission prompt (driver failed to send the accept — see below). The idle pattern above is from the pre-prompt ready state; confirm the post-turn idle at E2E (should be the same `❯` input box returning after the spinner stops).

## 6. Detection fragility (design risk)

Scraping a cursor-repainted TUI (no spaces, redraws, spinners) for "idle" and "permission" is brittle. Mitigations: whitespace-insensitive tail matching; debounce; treat as best-effort with manual fallbacks (manual Stop, manual answer in the Terminal tab, manual drag-to-Done). Consider whether claude exposes a cleaner interactive signal (hooks / status line) before over-investing in scraping.

## Open (validate at E2E)
- Confirm `\r` dismisses the permission prompt post-submit (both spike runs failed to SEND it — v1 sent wrong key `1\r`, v2's detector didn't fire due to the no-spaces bug). High confidence given the trust prompt accepted with `\r`.
- Capture the exact post-turn idle bytes.
