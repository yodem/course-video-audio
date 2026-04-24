# course-video-audio

**Turn an entire Moodle / Lemida course into a NotebookLM notebook full of listenable MP3 lectures — in one command.**

Built for Bar-Ilan University's [lemida.biu.ac.il](https://lemida.biu.ac.il), but the approach works on any Moodle instance that uses the `videostream` plugin.

What it does, in plain English:

1. Reads your course's video list using your existing browser login (no password handling).
2. Downloads every lecture video to your Mac.
3. Extracts just the audio as MP3 files.
4. Uploads each MP3 into a NotebookLM notebook so you can listen, search, chat with, and make audio summaries of them.

You end up with a folder of MP3s **and** a NotebookLM notebook where every source is one lecture. Perfect for studying on a commute, or letting NotebookLM generate a podcast-style overview for the whole semester.

---

## Is this for me?

**Yes, if you:**
- Study at a university whose lectures live on Moodle / Lemida as streamed videos.
- Want to listen to lectures while walking, driving, or running.
- Use NotebookLM to study and want lectures auto-imported.

**You do not need to be a programmer.** You will copy a few lines into a Terminal, paste some cookies once, and press Enter. The sections below walk you through every step.

---

## What you need first

Four free things. Don't panic — each is one command. Pick your OS below.

<details open>
<summary><strong>🍎 macOS</strong></summary>

### 1. Homebrew (the installer for the other tools)

Open Terminal (press ⌘-Space, type "Terminal", hit Enter) and paste:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts.

### 2. Node.js, ffmpeg, yt-dlp, pipx

```bash
brew install node ffmpeg yt-dlp pipx
pipx ensurepath
```

Close and reopen Terminal after this.

### 3. The NotebookLM CLI (`nlm`)

```bash
pipx install nlm
nlm login
```

`nlm login` opens a browser — sign in with the Google account you use for NotebookLM. Do this once.

### 4. This tool

```bash
cd ~
git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

</details>

<details>
<summary><strong>🪟 Windows 10 / 11</strong></summary>

Everything below uses `winget`, which ships with Windows 10 (since 2021) and Windows 11. If `winget --version` fails, install "App Installer" from the Microsoft Store once and retry.

Open **Windows Terminal** or **PowerShell** (press `Win`, type "PowerShell", Enter). **Do not** use the old Command Prompt (`cmd.exe`); a few commands below expect PowerShell.

### 1. Node.js, Git, ffmpeg, yt-dlp, Python

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Git.Git
winget install --id Gyan.FFmpeg
winget install --id yt-dlp.yt-dlp
winget install --id Python.Python.3.12
```

Close and reopen PowerShell after this so the new commands land on your `PATH`.

Verify:

```powershell
node --version ; git --version ; ffmpeg -version ; yt-dlp --version ; python --version
```

All five should print a version, not an error.

### 2. pipx + the NotebookLM CLI (`nlm`)

```powershell
python -m pip install --user pipx
python -m pipx ensurepath
```

Close and reopen PowerShell, then:

```powershell
pipx install nlm
nlm login
```

`nlm login` opens a browser — sign in with your Google account for NotebookLM.

### 3. This tool

```powershell
cd $HOME
git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

**Windows gotchas:**
- If `npm install` fails on native build steps, install Visual Studio Build Tools: `winget install --id Microsoft.VisualStudio.2022.BuildTools`, then re-run `npm install`.
- `"Close Chrome completely"` on Windows means right-clicking the Chrome icon in the system tray (bottom-right) → "Exit", or closing every Chrome window and every tab — the Chrome icon in the taskbar should no longer be present. Chrome flushes its on-disk cookie store on full shutdown; until it does, yt-dlp may read a stale `MoodleSessionprod`.
- Paths like `./out/106813/audio` work in PowerShell exactly as shown — no need to translate to backslashes.

</details>

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian)</strong></summary>

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg yt-dlp python3-pip pipx git
pipx ensurepath

# reopen your terminal, then:
pipx install nlm
nlm login

git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

On Fedora/RHEL swap `apt` for `dnf`. Arch: `pacman -S nodejs npm ffmpeg yt-dlp python-pipx git`.

</details>

---

## Set it up (the one non-trivial step)

### Step A — Get your browser cookie

The tool uses your existing Chrome session so it never sees your password. There are two ways to give it your session:

**Option 1 (recommended) — let it pull from Chrome automatically.**
- Keep `"cookiesFromBrowser": "chrome"` in `config.json` (see next section).
- Log into `lemida.biu.ac.il` in Chrome.
- **Close Chrome completely** before running the tool for the first time. Chrome buffers cookie writes to disk — closing it forces a flush so the tool reads the latest session.

**Option 2 (fallback) — paste the cookie directly.**
Works even if Chrome is running. Install the Chrome extension [EditThisCookie](https://chromewebstore.google.com/), log into Lemida, click the extension, press the "Export" icon (looks like `[`), and paste what it copies into `config.json`'s `"cookies"` array.

The only cookie that actually matters for login is **`MoodleSessionprod`**. Everything else is analytics.

### Step B — Edit `config.json`

```bash
cp config.example.json config.json
open config.json        # opens in TextEdit
```

Find the `"courses"` block and fill in:

```json
"courses": {
  "123456": {
    "url":        "https://lemida.biu.ac.il/course/view.php?id=123456",
    "notebookId": null,
    "title":      "My Course Name"
  }
}
```

- `123456` is the course ID. You'll see it in the URL when you're on the course page (`...view.php?id=123456`).
- `notebookId: null` means "create a new NotebookLM notebook on the first run". If you want to add into an existing notebook, paste its ID here.

Set `"defaultCourse": "123456"` so the tool knows which course to run without you typing it.

You can add as many courses as you like; each gets its own folder under `./out/<course-id>/`.

---

## Run it

```bash
npm run all
```

That's it. You'll see lines like:

```
[17:43:31] Course : My Course Name (123456)
[17:43:31] Notebook: (will create new)
[17:43:38] Merged cookies: 4 manual + 103 from chrome.
[17:43:40] Found 24 video activity link(s).
[17:43:42]   [001/024] Lecture 1 — Introduction
[17:43:45]      → 001-8811223-lecture-1-introduction.mp4
...
Downloading [001]: Lecture 1 — Introduction
    100% (312.4 / 312.4 MB)
Audio [001]: Lecture 1 — Introduction
  Extracting → 001-8811223-lecture-1-introduction.mp3
Uploading [001] 001-8811223-lecture-1-introduction.mp3
...

══════════════════════════════════════════
  SUMMARY
══════════════════════════════════════════
  Activities discovered : 24
  With MP4 URL          : 24
  MP4s downloaded       : 24
  MP3s extracted        : 24
  Uploaded to NotebookLM: 24

  All items processed successfully.

  Audio files → /Users/you/course-video-audio/out/123456/audio
  NotebookLM  → https://notebooklm.google.com/notebook/abc…
══════════════════════════════════════════
```

Click the NotebookLM link at the bottom — your lectures are already there as sources.

### Running one step at a time

```bash
npm run discover   # find all video URLs
npm run download   # download MP4s
npm run audio      # convert to MP3
npm run upload     # upload MP3s to NotebookLM
npm run all        # everything in order (default)
```

Re-running is safe — the tool skips anything it's already done. Great for resuming after a crash, a closed laptop, or a flaky WiFi.

### Running a different course ad-hoc

```bash
node run.mjs --url "https://lemida.biu.ac.il/course/view.php?id=99999" --notebook <existing-notebook-id>
```

Or just add another entry under `courses` and use `--course 99999`.

---

## When it doesn't work

### "Redirected to login/enrol — session cookie is expired or missing."

Your Lemida session has expired server-side or Chrome's on-disk cookie is stale.

- **Fix the fast way:** log back into `lemida.biu.ac.il` in Chrome, fully quit Chrome (⌘-Q), re-run.
- **Fix the bulletproof way:** export the cookie with EditThisCookie and paste it into `config.json`'s `cookies` array. Manual cookies take precedence over whatever yt-dlp finds, so this always wins.

### "nlm CLI not found on PATH"

Run `pipx ensurepath`, then close and reopen Terminal. If that fails: `pipx install nlm` again and check `which nlm`.

### NotebookLM "source processing" hangs

Lectures are long; raising `notebooklm.waitTimeoutSeconds` to `3600` (an hour) works for very long files. Rerunning resumes from where it left off — it won't re-upload anything it's already uploaded.

### Downloads start but stop partway

The tool writes to `<name>.mp4.part` and only renames on completion. A crashed download leaves the `.part` file; the next run will start fresh and overwrite it.

---

## Where your files live

```
course-video-audio/
├── config.json                            ← your config (never committed)
├── run.mjs                                ← the script
└── out/
    └── 123456/                            ← one folder per course
        ├── downloads/                     ← .mp4 files
        ├── audio/                         ← .mp3 files (the keepers)
        └── manifests/
            ├── 123456-<timestamp>.json    ← what discover() found
            └── uploads.json               ← NotebookLM ID + upload log
```

You can safely delete any of these and rerun; the tool will rebuild them.

---

## Privacy & safety

- **No passwords are read or stored** — just a session cookie, which you control and can revoke at any time (by logging out of Lemida or closing your browser).
- **`config.json` is gitignored** by default. Don't commit it.
- Uploaded MP3s go to **your** NotebookLM account, signed in via `nlm login`.
- The tool only contacts `lemida.biu.ac.il` (to fetch your videos) and `notebooklm.google.com` via `nlm` (to upload). Nothing else.

---

## For developers / AI agents

See [`CLAUDE.md`](./CLAUDE.md) for an architectural overview and [`AGENTS.md`](./AGENTS.md) for conventions and load-bearing details an AI assistant should know before editing.

---

## License

MIT.
