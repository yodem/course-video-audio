# CLAUDE.md — Project overview for Claude Code

## What this project is

A single-file Node.js tool that turns a Moodle / Lemida course into a NotebookLM notebook of MP3 lectures:

1. **Discover** — Playwright + the user's browser cookies scrape every `modtype_videostream` activity on a course page and follow each link to read the `<source type="video/mp4">` URL served by the page.
2. **Download** — native `https.get()` pulls the MP4 from Oracle Object Storage (public URL once discovered), with redirect following, `.part` file atomicity, and `[skip]` on existing files.
3. **Audio** — `ffmpeg -vn -acodec libmp3lame -q:a 4` extracts MP3.
4. **Upload** — shells out to the `nlm` CLI: `nlm notebook create` (or reuses a configured notebook ID), then `nlm source add --file <mp3> --title <lecture> --wait --wait-timeout N` per file.

Everything lives in `run.mjs` (~29 KB). One dependency (`playwright`); external binaries (`ffmpeg`, `yt-dlp`, `nlm`) are resolved at runtime.

## Repo layout

```
run.mjs                 # the whole tool
config.example.json     # template config
package.json            # scripts: start, discover, download, audio, upload, all
debug-cookies.mjs       # tiny helper to see what yt-dlp extracted from Chrome
README.md               # user-facing setup for non-technical students
CLAUDE.md               # this file
AGENTS.md               # conventions & load-bearing bits an AI agent must respect
```

At runtime each course gets its own `out/<courseId>/{downloads,audio,manifests}/` tree, created on demand.

## Key commands

```bash
npm install && npx playwright install chromium    # first-time setup
cp config.example.json config.json                # fill in a course + cookies
npm run all                                       # run the whole pipeline
node run.mjs --course <id> --step audio           # run one step on one course
node run.mjs --url <...> --notebook <nbid>        # ad-hoc, no config edit
```

`node --check run.mjs` is a fast syntax smoke test. `npm run upload` with a missing manifest prints a clean error.

## Architectural notes

- **Cookies are the tricky part.** The tool prefers the user's manual `cookies` array over `yt-dlp --cookies-from-browser` output, because Chrome lags its on-disk cookie DB behind the live session (cookies flush when Chrome closes). `mapManualCookies()` normalises `sameSite: 'unspecified'` to `Lax` — setting it to `None` without `Secure=true` causes Chromium to silently drop the cookie at the HTTP layer.
- **Per-course state is in `out/<id>/manifests/uploads.json`.** Holds `{ notebookId, sources: { <mp3Path>: { title, uploadedAt } } }`. Flushed after every upload so Ctrl-C is safe.
- **Notebook ID resolution** uses `nlm notebook list --json` as the authoritative post-create lookup, with a regex over `nlm notebook create` stdout as a fallback. Parsing `create` stdout alone is brittle across nlm versions.
- **Upload failures don't abort the pipeline.** If `nlm` is missing or notebook creation fails, `uploadToNotebookLM()` returns `skipped: true` with a list of `failed` items, and `verify()` still runs so the user sees the audio artifacts it did produce.
- **Idempotency everywhere.** Each step checks disk (or the uploads state file) and skips work already done. A full rerun after success should report every step as `[skip]`.

## Verification

There's no test suite. Verification is behavioural:

1. `node --check run.mjs` — syntax
2. `node run.mjs --step upload` with no manifest — should print `No manifest for course …` and exit cleanly.
3. `curl -sI -b "MoodleSessionprod=<value>" "<course url>" | head -1` — quick ground-truth check on whether a cookie is accepted server-side (expect `HTTP/1.1 200 OK`; a 302 means the cookie is dead).
4. Full run: `npm run all` with a real course. Success = NotebookLM URL printed at end, sources visible in browser.

## Gotchas

- **Hebrew filenames:** the slugifier strips non-ASCII; filename format is `<NNN>-<moduleId>-<asciiSlug>.mp4`. Titles inside manifests and NotebookLM preserve original text.
- **Long lectures + NotebookLM:** `nlm source add --wait` default is 600s; `notebooklm.waitTimeoutSeconds` should be 1800+ for 1h+ lectures.
- **Playwright login flow:** headless mode aborts on redirect to login/enrol; `--headed` opens a visible browser so the user can log in interactively (5-minute poll window).
- **Non-Moodle targets:** selectors are specific to `modtype_videostream`. Any other Moodle video plugin needs edits in `discover()`.
