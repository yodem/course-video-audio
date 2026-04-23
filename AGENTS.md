# AGENTS.md — How AI coding agents should work on this repo

This file is a compact contract between humans and AI assistants editing `run.mjs`. Read before making changes.

## Ground truth before assumptions

`run.mjs` is small (~500 lines) — read it end-to-end before proposing a change. Do not rely on the README as a source of truth for code behaviour; the README is written for students, `CLAUDE.md` for orientation, and the code itself is authoritative.

Before declaring a fix works, run one of:

- `node --check run.mjs` — syntax.
- `node run.mjs --step upload` (no manifest present) — exercises config + arg parsing paths without network.
- `curl -sI -b "MoodleSessionprod=<value>" "<course url>" | head -1` — checks a cookie value against the live server. Expect `HTTP/1.1 200 OK`. A 302 means the cookie is dead, no amount of code changes will help; tell the user to re-login.
- Full `npm run all` against a real course with a valid cookie — the only way to verify discovery + download + audio + upload.

"It type-checks" is not evidence the pipeline works.

## Load-bearing details — do not silently change

These have each fixed a real bug and the code would regress without them.

1. **Manual cookies override browser cookies by name** (`getCookies()`). The user's pasted cookie is authoritative; Chrome's on-disk cookie store lags the live session, so yt-dlp can return a stale `MoodleSessionprod`. Preferring browser values would revive the "bounced to login" bug.

2. **`sameSite: 'unspecified'` maps to `'Lax'`, not `'None'`** (`mapManualCookies()`). SameSite=None on a non-Secure cookie is silently dropped by Chromium. Mapping to Lax matches Chrome's current default.

3. **`SameSite === 'None'` forces `secure: true`** (`mapManualCookies()`). Same reason — without it, the cookie won't stick.

4. **`createNotebook()` resolves ID via `nlm notebook list --json`**, not by parsing `nlm notebook create` stdout. The CLI has no `--json` flag on `create` and its output format changes between versions.

5. **Notebook-resolution errors don't throw through `main()`**. `uploadToNotebookLM()` catches them and returns `{ skipped: true, failed: <items> }` so `verify()` still runs and the user sees the mp3s that were produced. Removing the try/catch resurrects the "stack trace, no summary" failure mode.

6. **Upload state is flushed after every successful upload** (`saveUploadState()` inside the per-item loop). Don't batch the writes — a Ctrl-C mid-run must leave the state file consistent.

7. **`.part` file atomicity on download** — `downloadFile()` writes to `dest + '.part'` and renames on finish. Don't short-circuit this; partial downloads masquerading as complete corrupt `extractAudio()` later.

8. **Per-course output tree** (`resolveOutputPaths(cfg, courseId)`). Everything for course `X` lives under `out/X/`. Don't flatten it; collisions between courses are silent and destructive.

## What's fair game

- Adding parallelism to `downloadAll()` (Promise.all with a concurrency cap) — downloads are I/O-bound and the server handles it.
- Swapping the native `https.get` download for a library (e.g. `undici`) if you're adding other deps anyway.
- Replacing `querySelector("source[type='video/mp4']")` in `discover()` with something more robust across Moodle skins — as long as you keep a fallback to the current selector.
- Adding a `--list-courses` flag that prints `cfg.courses` and exits.
- Fixing the slugifier to keep more Hebrew/Arabic characters (current one drops all non-ASCII).

## What needs explicit approval

- Creating GitHub repos, pushing code, opening PRs, or publishing anything.
- Changing dependencies in `package.json` (add or remove).
- Removing or renaming existing CLI flags or `--step` values — scripts in package.json and the README both reference them.
- Editing `config.json` (it's the user's real data). `config.example.json` is fair game.

## Style

- Keep `run.mjs` as a single file. Splitting into modules adds import bookkeeping with no real payoff for a script this size.
- No TypeScript, no build step, no test framework. If you need a test, write a one-shot script under a `scripts/` folder.
- Comments only where behaviour is non-obvious (see the `// SameSite=None requires Secure=true` comment as the template).
- No emoji, no decorative headers in code — the log uses plain bracketed timestamps for a reason (grep-friendly).

## When the user says "it doesn't work"

First ask: **which step failed, and what does the log say?** Then:

- Bounce to login → cookie problem. Run the curl ground-truth check. If the cookie is valid, the bug is in cookie handling (look at SameSite / Secure / merge order). If it's invalid, tell the user to re-login and re-export.
- 0 activities discovered → selector or DOM changed. Pull the HTML manually with curl and verify `li.activity.modtype_videostream` is still present.
- Downloads fail mid-way → likely network; rerun is idempotent.
- NotebookLM upload fails → check `nlm doctor`, confirm `nlm login` is still valid. Raise `notebooklm.waitTimeoutSeconds` for long lectures.
- Pipeline "succeeded" but no MP3s → check manifests. If `mp4Url` is null across the board, the video page markup changed.
