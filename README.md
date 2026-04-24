# course-video-audio

**Turn an entire Moodle / Lemida course into a NotebookLM notebook full of listenable MP3 lectures — in one command.**

Built for Bar-Ilan University's [lemida.biu.ac.il](https://lemida.biu.ac.il), but the approach works on any Moodle instance that uses the `videostream` plugin.

What it does, in plain English:

1. Reads your course's video list using your existing browser login (no password handling).
2. Downloads every lecture video to your computer.
3. Extracts just the audio as MP3 files.
4. Uploads each MP3 into a NotebookLM notebook so you can listen, search, chat with, and make audio summaries of them.

You end up with a folder of MP3s **and** a NotebookLM notebook where every source is one lecture. Perfect for studying on a commute, or letting NotebookLM generate a podcast-style overview for the whole semester.

---

## Is this for me?

**Yes, if you:**
- Study at a university whose lectures live on Moodle / Lemida as streamed videos.
- Want to listen to lectures while walking, driving, or running.
- Use NotebookLM to study and want lectures auto-imported.

**You do not need to be a programmer.** If you've never opened a terminal before, read the section right below. It assumes zero prior knowledge.

---

## Never used a terminal before? Read this first (5 minutes)

A **terminal** (also called "shell", "command line", "console", "PowerShell") is just a window where you type commands instead of clicking buttons. You can't break anything important by typing the commands in this guide — they all live inside your own home folder.

### The three things you need to know

1. **Type (or paste) one line, then press Enter.** That's it. Every "command" below is one line. Copy it, paste it, Enter. The terminal does its thing and gives you a new blank line when it's done. Wait for the new blank line before typing the next command.

2. **No output usually means success.** Unlike a phone app, a terminal is quiet when things work. If it prints a bunch of text and then a fresh empty prompt appears — you're good. If you see the word **error** or **not found** or a big red line, that's when to pay attention.

3. **How to copy-paste.**
   - **macOS Terminal:** highlight → `⌘-C`, click inside the terminal → `⌘-V`.
   - **Windows PowerShell / Windows Terminal:** highlight → `Ctrl-C`, click inside the terminal → `Ctrl-V` (or just right-click once).
   - **Linux GNOME Terminal:** `Ctrl-Shift-C` / `Ctrl-Shift-V`. (Regular `Ctrl-C` in a terminal means "cancel the running command".)

### How to open a terminal

| OS | How |
|----|-----|
| macOS | Press `⌘-Space`, type **Terminal**, press Enter |
| Windows 10 / 11 | Press the `Windows` key, type **PowerShell**, press Enter (pick "Windows PowerShell" — *not* "Command Prompt") |
| Ubuntu | Press `Ctrl-Alt-T`, or search "Terminal" in the apps menu |

A window with a blinking cursor opens. That's where everything below gets pasted.

### Two pieces of jargon that show up a lot

- **`cd course-video-audio`** — "cd" is "change directory". It just means "step into this folder". After you run it, further commands run inside that folder.
- **`npm install`** — "npm" is Node's package installer. It reads the project's list of required libraries and downloads them. It will print lots of lines for a minute or two; that's normal.

If something goes wrong, skip to the **[When it doesn't work](#when-it-doesnt-work)** section at the bottom.

---

## What you need first

Four free things. Don't panic — each is one command. Pick your OS below.

<details open>
<summary><strong>🍎 macOS — step-by-step</strong></summary>

### 1. Open Terminal

Press `⌘-Space`, type `Terminal`, hit Enter. A small dark window appears with a blinking cursor. Keep this window open for the rest of the setup.

### 2. Install Homebrew (the installer that installs the other tools)

Homebrew is a free, safe, standard tool that 99% of Mac developers use. You only install it once.

Copy this entire line, paste it into Terminal, press Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will ask for your Mac login password (the one you use to log into the computer). Type it — you won't see any characters appear, that's normal for security. Press Enter. Wait a few minutes.

When it's done and a fresh prompt appears, check it worked:

```bash
brew --version
```

You should see something like `Homebrew 4.x.x`. If you see "command not found", Homebrew printed two commands at the very end of its install that you need to copy-paste first (they start with `echo` and `eval`). Do those, then `brew --version` again.

### 3. Install Node.js, ffmpeg, yt-dlp, pipx

Still in Terminal, paste this one line:

```bash
brew install node ffmpeg yt-dlp pipx
```

This downloads four tools at once. Takes a couple of minutes. When it's done, one more command:

```bash
pipx ensurepath
```

**Now fully close Terminal** (⌘-Q) and reopen it. This is necessary for the newly installed commands to become findable.

### 4. Install the NotebookLM CLI (`nlm`)

```bash
pipx install nlm
nlm login
```

`nlm login` opens a browser tab. Sign in with the Google account you use for NotebookLM. When the browser says "authenticated", go back to Terminal — you'll see a success message.

### 5. Download the tool

```bash
cd ~
git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

`cd ~` means "go to my home folder". `git clone` downloads the project from GitHub. `cd course-video-audio` steps into the downloaded folder. `npm install` downloads the libraries the tool needs. `npx playwright install chromium` downloads a private copy of Chrome the tool uses to visit Lemida.

If every command finished without red "error" lines — you're done installing.

</details>

<details>
<summary><strong>🪟 Windows 10 / 11 — step-by-step</strong></summary>

### 1. Open PowerShell

Press the `Windows` key. Type **PowerShell**. Pick **Windows PowerShell** (blue icon) — *not* "Command Prompt". Press Enter. A blue window opens with a blinking cursor. Keep it open for the rest of the setup.

### 2. Check that `winget` works

`winget` is Microsoft's built-in installer (ships with Windows 10 since 2021 and all of Windows 11). Type:

```powershell
winget --version
```

If you see a version number — great, skip to step 3.

If you see "not recognised": open the **Microsoft Store**, search for **App Installer**, click **Update** (or install). Close PowerShell, reopen it, try `winget --version` again.

### 3. Install Node.js, Git, ffmpeg, yt-dlp, Python

Paste these one at a time. After each line, wait until you see a fresh prompt before pasting the next.

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Git.Git
winget install --id Gyan.FFmpeg
winget install --id yt-dlp.yt-dlp
winget install --id Python.Python.3.12
```

Windows may pop up a UAC "Do you want to allow this app to make changes?" box — click **Yes** each time.

**Fully close PowerShell (click the X) and reopen it.** This is mandatory — new commands won't appear in a window that was already open.

Verify everything installed:

```powershell
node --version ; git --version ; ffmpeg -version ; yt-dlp --version ; python --version
```

Five version numbers should print. If any says "not recognised", close and reopen PowerShell once more — the `PATH` sometimes takes a second reopen to pick up.

### 4. Install pipx + the NotebookLM CLI (`nlm`)

```powershell
python -m pip install --user pipx
python -m pipx ensurepath
```

**Close PowerShell and reopen it again** (yes, again — this is the Windows way).

```powershell
pipx install nlm
nlm login
```

`nlm login` opens your browser. Sign in with the Google account for NotebookLM. Back to PowerShell when it says "authenticated".

### 5. Download the tool

```powershell
cd $HOME
git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

`cd $HOME` goes to your home folder (usually `C:\Users\YourName`). The rest downloads the project and its libraries.

**If `npm install` fails with native-build errors** (you'll see mentions of "node-gyp", "MSBuild", or "Visual Studio"), run once:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools
```

Accept the default C++ workload. Then rerun `npm install`.

</details>

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian) — step-by-step</strong></summary>

### 1. Open a terminal

`Ctrl-Alt-T`, or search "Terminal" in your apps.

### 2. Install everything

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg yt-dlp python3-pip pipx git
pipx ensurepath
```

`sudo` will ask for your login password (nothing shows when you type — normal). Close and reopen the terminal.

### 3. NotebookLM CLI

```bash
pipx install nlm
nlm login
```

Browser opens → sign in → done.

### 4. Download the tool

```bash
git clone https://github.com/yodem/course-video-audio.git
cd course-video-audio
npm install
npx playwright install chromium
```

On Fedora/RHEL swap `apt` for `dnf`. On Arch: `sudo pacman -S nodejs npm ffmpeg yt-dlp python-pipx git`.

</details>

---

## Set it up (the one non-trivial step)

### Step A — Log into Lemida in Chrome

Open Chrome and sign into `https://lemida.biu.ac.il`. **Keep that tab open** — the tool will borrow your login from Chrome.

### Step B — Copy the example config to your own config

In your terminal (still inside the `course-video-audio` folder from the install step):

**macOS / Linux:**
```bash
cp config.example.json config.json
open config.json
```

**Windows:**
```powershell
Copy-Item config.example.json config.json
notepad config.json
```

A text editor opens. Find the `"courses"` block near the bottom and change it to your course:

```json
"courses": {
  "123456": {
    "url":        "https://lemida.biu.ac.il/course/view.php?id=123456",
    "notebookId": null,
    "title":      "My Course Name"
  }
}
```

**How to find the course number (`123456`):** open the course in Chrome — the URL will look like `https://lemida.biu.ac.il/course/view.php?id=123456`. That last number is your course ID. Replace `123456` everywhere above with your actual number.

- `notebookId: null` means "create a brand-new NotebookLM notebook on the first run". Leave it as `null` the first time.
- `title` is just what you want the NotebookLM notebook to be called.

Also change `"defaultCourse": "106813"` to your course number (e.g., `"defaultCourse": "123456"`) so you don't have to type it on the command line.

Save the file (`⌘-S` on Mac, `Ctrl-S` on Windows/Linux) and close the editor.

---

## Run it

Back in your terminal, still inside the `course-video-audio` folder:

```bash
npm run all
```

You'll see lines like this scroll by:

```
[17:43:31] Course : My Course Name (123456)
[17:43:31] Notebook: (will create new)
[17:43:38] Merged cookies: 4 manual + 103 from chrome.
[17:43:40] Found 24 video activity link(s).
[17:43:42]   [001/024] Lecture 1 — Introduction
[17:43:45]          → 001-8811223-lecture-1-introduction.mp4
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

Time on a full course: roughly 1–3 minutes per lecture (downloads + audio extraction are fast; NotebookLM ingestion is the slow part). Let it run in the background; you can walk away.

Click the NotebookLM link at the bottom — your lectures are already there as sources. You can open each one, listen, chat with it, or have NotebookLM generate an audio overview of the whole course.

### Running one step at a time

If you want to pause between stages:

```bash
npm run discover   # find all video URLs (writes a manifest)
npm run download   # download MP4s
npm run audio      # convert MP4s to MP3s
npm run upload     # send MP3s to NotebookLM
npm run all        # everything in order (the default)
```

Re-running is always safe — every step checks what's already on disk and skips it. Great for resuming after a crash, a closed laptop, or flaky WiFi.

### Running a different course ad-hoc

Add another entry under `courses` in `config.json`, then:

```bash
npm run all -- --course 999999
```

Or without editing `config.json` at all:

```bash
node run.mjs --url "https://lemida.biu.ac.il/course/view.php?id=999999"
```

---

## When it doesn't work

### "Redirected to login/enrol — session cookie is expired or missing."

Your Lemida session has expired or Chrome's on-disk cookie is stale.

**Fast fix:**
1. Open Chrome, go to https://lemida.biu.ac.il, make sure you're still signed in.
2. Fully quit Chrome. On **macOS** press `⌘-Q`. On **Windows** close every Chrome window, then right-click the Chrome icon in the system tray (bottom-right next to the clock) and pick "Exit" — the icon should disappear. On **Linux** `Ctrl-Q` or close all windows.
3. Rerun `npm run all`.

**Bulletproof fix (works even if Chrome is running):**
1. In Chrome, install the [EditThisCookie](https://chromewebstore.google.com/) extension.
2. On the Lemida page, click the EditThisCookie icon → find the `MoodleSessionprod` row → click the blue pencil on its Value → copy the Value.
3. Open `config.json`, find the `"cookies"` array, paste your value as the `value` for `MoodleSessionprod`. Save.
4. Rerun `npm run all`.

### "nlm CLI not found on PATH" / "pipx: command not found"

You need to fully close and reopen your terminal after `pipx ensurepath`. If it still doesn't work, run `pipx install nlm` one more time and then `which nlm` (macOS/Linux) or `where.exe nlm` (Windows) — if that prints a path, restart your terminal once more.

### NotebookLM "source processing" hangs

Lectures are long and NotebookLM can be slow. Raise the timeout in `config.json`:

```json
"notebooklm": { "enabled": true, "waitTimeoutSeconds": 3600 }
```

Rerunning resumes from where it left off — it won't re-upload anything already uploaded.

### Downloads start but stop partway

A partially-downloaded file is named `<something>.mp4.part`. The next run deletes it and starts fresh for that lecture only. Everything else is kept.

### Nothing happens when I paste a command

- Check that you clicked inside the terminal window first (the title bar should look "active").
- On Windows, don't use the old Command Prompt — use PowerShell.
- Make sure you copied the whole line, not just part of it.
- Press Enter after pasting.

---

## Where your files live

```
course-video-audio/
├── config.json                            ← your config (never committed to git)
├── run.mjs                                ← the script
└── out/
    └── 123456/                            ← one folder per course
        ├── downloads/                     ← .mp4 files
        ├── audio/                         ← .mp3 files (the keepers)
        └── manifests/
            ├── 123456-<timestamp>.json    ← what was discovered on the course page
            └── uploads.json               ← which NotebookLM notebook + upload log
```

You can safely delete any of these and rerun; the tool will rebuild them. Deleting `uploads.json` means "start a new notebook next time".

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
