#!/usr/bin/env node
/**
 * course-video-audio
 *
 * Usage:
 *   node run.mjs [--config config.json] [--url <courseUrl>] [--step discover|download|audio|all]
 *
 * Cookie modes (set in config.json):
 *   "cookiesFromBrowser": "chrome"   ← reads live from Chrome via yt-dlp (recommended)
 *   "cookies": [...]                 ← manual cookie array (fallback)
 *
 * Selectors verified against lemida.biu.ac.il:
 *   Activity links : li.activity.modtype_videostream a[href]
 *   MP4 source     : source[type='video/mp4']  (server-side rendered)
 *   Activity title : [data-activityname]
 */

import { chromium } from 'playwright';
import { spawnSync, execFileSync } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import https from 'https';
import http from 'http';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  return {
    configPath: get('--config') ?? join(__dirname, 'config.json'),
    urlOverride: get('--url'),
    courseIdOverride: get('--course'),
    notebookOverride: get('--notebook'),
    titleOverride: get('--title'),
    step: get('--step') ?? 'all',
    headed: args.includes('--headed'),
  };
}

function loadConfig(configPath) {
  const fallback = join(__dirname, 'config.example.json');
  const path = existsSync(configPath) ? configPath : fallback;
  if (path === fallback) console.warn(`[warn] No config.json — using config.example.json defaults.`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Resolve which course to run against. Precedence:
 *   1. --url (+ optional --notebook, --title) : ad-hoc
 *   2. --course <id>                          : look up cfg.courses[id]
 *   3. cfg.defaultCourse                      : look up cfg.courses[defaultCourse]
 *   4. cfg.courseUrl (legacy single-course)   : use as-is
 */
function resolveCourse(cfg, args) {
  if (args.urlOverride) {
    const parsedId = new URL(args.urlOverride).searchParams.get('id') ?? 'adhoc';
    return {
      id: String(parsedId),
      url: args.urlOverride,
      notebookId: args.notebookOverride ?? cfg.courses?.[parsedId]?.notebookId ?? null,
      title: args.titleOverride ?? cfg.courses?.[parsedId]?.title ?? `BIU Course ${parsedId}`,
    };
  }
  const courseId = args.courseIdOverride ?? cfg.defaultCourse ?? null;
  if (courseId && cfg.courses?.[courseId]) {
    const c = cfg.courses[courseId];
    return {
      id: String(courseId),
      url: c.url,
      notebookId: args.notebookOverride ?? c.notebookId ?? null,
      title: args.titleOverride ?? c.title ?? `BIU Course ${courseId}`,
    };
  }
  if (cfg.courseUrl) {
    const parsedId = new URL(cfg.courseUrl).searchParams.get('id') ?? 'course';
    return {
      id: String(parsedId),
      url: cfg.courseUrl,
      notebookId: args.notebookOverride ?? cfg.notebooklm?.reuseNotebookId ?? null,
      title: args.titleOverride ?? cfg.notebooklm?.notebookTitle ?? `BIU Course ${parsedId}`,
    };
  }
  throw new Error('No course configured. Add a `courses` map with a `defaultCourse` to config.json, or pass --url / --course.');
}

/**
 * Per-course output directories. Layout: <root>/<courseId>/{downloads,audio,manifests}/
 * Falls back to legacy flat layout if cfg.output has explicit downloads/audio/manifests paths.
 */
function resolveOutputPaths(cfg, courseId) {
  const resolve = (p) => (p.startsWith('./') ? join(__dirname, p.slice(2)) : p);
  const out = cfg.output ?? {};
  if (out.root) {
    const root = resolve(out.root);
    return {
      downloads: join(root, courseId, 'downloads'),
      audio:     join(root, courseId, 'audio'),
      manifests: join(root, courseId, 'manifests'),
    };
  }
  // Legacy: flat single-course layout
  return {
    downloads: resolve(out.downloads ?? './downloads'),
    audio:     resolve(out.audio ?? './a'),
    manifests: resolve(out.manifests ?? './manifests'),
  };
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

// Windows FILETIME epoch (1601-01-01) vs Unix epoch (1970-01-01), in seconds.
// yt-dlp occasionally emits Chrome's raw FILETIME (microseconds since 1601-01-01)
// in the expiry column, so we detect & convert. See MSDN: FILETIME structure.
const WINDOWS_FILETIME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const WINDOWS_FILETIME_MICROSECONDS_THRESHOLD = WINDOWS_FILETIME_EPOCH_OFFSET_SECONDS * 1_000_000;
// Values beyond this are unambiguously milliseconds (> year 2970 in seconds).
const MILLISECOND_EPOCH_THRESHOLD = 32_503_680_000;

function hostnameFromUrl(u) {
  try { return new URL(u).hostname; } catch { return null; }
}

/** Registrable domain (etld+1-ish) — last two labels. Good enough for Moodle hosts. */
function baseDomain(host) {
  if (!host) return null;
  const parts = host.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}

/**
 * Extract cookies from the live Chrome browser using yt-dlp.
 * Writes a Netscape cookies.txt to a private tmp directory, parses it, cleans up.
 */
function extractCookiesFromBrowser(browser = 'chrome', targetUrl = null) {
  let ytdlp = null;
  const home = process.env.HOME ?? '';
  for (const candidate of ['yt-dlp', `${home}/.pyenv/shims/yt-dlp`, '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); ytdlp = candidate; break; } catch {}
  }
  if (!ytdlp) throw new Error('yt-dlp not found. Install with: brew install yt-dlp');

  const url = targetUrl ?? 'https://lemida.biu.ac.il/';
  const filterDomain = baseDomain(hostnameFromUrl(url));
  if (!filterDomain) throw new Error(`Cannot derive cookie filter domain from URL: ${url}`);

  // Private tmp dir — mkdtempSync creates with mode 0o700 on POSIX, so the cookie file
  // is not world-readable. Wrapped in try/finally to guarantee cleanup on crash.
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'cva-cookies-'));
  const tmpFile = join(tmpDir, 'cookies.txt');
  log(`Extracting cookies from ${browser} via yt-dlp (filter: ${filterDomain})…`);

  let lines;
  try {
    try {
      spawnSync(
        ytdlp,
        ['--cookies-from-browser', browser, '--cookies', tmpFile, '--skip-download', url],
        { stdio: ['ignore', 'ignore', 'ignore'] }
      );
    } catch (e) {
      throw new Error(`yt-dlp cookie extraction failed: ${e.message}`);
    }
    if (!existsSync(tmpFile)) throw new Error('yt-dlp did not produce a cookies file. Is the browser logged in to the target host?');
    lines = readFileSync(tmpFile, 'utf8').split('\n');
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  // Parse Netscape cookies.txt: domain includeSubdomains path secure expiry name value
  const cookies = [];
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [cookieDomain, , cookiePath, secureStr, expiryStr, name, value] = parts;
    if (!name || !value) continue;
    if (!cookieDomain.includes(filterDomain)) continue;

    let expires = -1;
    const rawExpiry = parseInt(expiryStr, 10);
    if (!isNaN(rawExpiry) && rawExpiry > 0) {
      if (rawExpiry > WINDOWS_FILETIME_MICROSECONDS_THRESHOLD) {
        expires = Math.floor(rawExpiry / 1_000_000) - WINDOWS_FILETIME_EPOCH_OFFSET_SECONDS;
        if (expires <= 0) expires = -1;
      } else if (rawExpiry > MILLISECOND_EPOCH_THRESHOLD) {
        expires = Math.floor(rawExpiry / 1000);
      } else {
        expires = rawExpiry;
      }
    }
    cookies.push({
      name: name.trim(),
      value: value.trim(),
      domain: cookieDomain.trim(),
      path: cookiePath.trim(),
      expires,
      httpOnly: false,
      secure: secureStr.trim().toUpperCase() === 'TRUE',
      sameSite: 'Lax', // safe default; manual cookies override by name anyway
    });
  }

  const hasSession = cookies.some(c => c.name === 'MoodleSessionprod');
  if (!hasSession) {
    throw new Error(
      `MoodleSessionprod cookie not found in ${browser}.\n` +
      `Please log in to ${filterDomain} in ${browser} and retry.`
    );
  }
  log(`Got ${cookies.length} ${filterDomain} cookie(s) including MoodleSessionprod.`);
  return cookies;
}

function mapManualCookies(list) {
  return list.map((c) => {
    // Normalise SameSite. Chrome's "unspecified" defaults to Lax; mapping it to None
    // requires Secure=true or Chromium silently drops the cookie (what bit us before).
    const raw = (c.sameSite ?? '').toLowerCase();
    let sameSite;
    if (raw === 'no_restriction' || raw === 'none') sameSite = 'None';
    else if (raw === 'strict') sameSite = 'Strict';
    else sameSite = 'Lax'; // covers 'lax', 'unspecified', and anything else
    const secure = sameSite === 'None' ? true : (c.secure ?? false);
    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
      httpOnly: c.httpOnly ?? false,
      secure,
      sameSite,
    };
  });
}

function getCookies(cfg, courseUrl) {
  const manual = cfg.cookies && cfg.cookies.length > 0 ? mapManualCookies(cfg.cookies) : [];
  if (cfg.cookiesFromBrowser) {
    try {
      const fromBrowser = extractCookiesFromBrowser(cfg.cookiesFromBrowser, courseUrl);
      // Merge: **manual cookies win by name**. The user's pasted cookies are
      // authoritative (just re-logged in). Chrome's on-disk DB lags the live
      // session — yt-dlp can return a stale MoodleSessionprod value.
      const manualNames = new Set(manual.map(c => c.name));
      const merged = [...manual, ...fromBrowser.filter(c => !manualNames.has(c.name))];
      if (manual.length > 0) log(`Merged cookies: ${manual.length} manual + ${merged.length - manual.length} from ${cfg.cookiesFromBrowser}.`);
      return merged;
    } catch (e) {
      log(`[warn] Could not extract cookies from browser: ${e.message}`);
      if (manual.length > 0) log(`[warn] Falling back to ${manual.length} manual cookie(s) from config.`);
      else log('[warn] Continuing without pre-injected cookies (will need interactive login).');
      return manual;
    }
  }
  return manual;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 80);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ─── Discovery ───────────────────────────────────────────────────────────────

async function discover(cfg, paths, courseUrl, headed = false) {
  const cookies = getCookies(cfg, courseUrl);

  log('Launching browser…');
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 100 : 0 });
  const manifest = [];
  try {
    const context = await browser.newContext();

    if (cookies.length > 0) {
      log(`Injecting ${cookies.length} cookie(s)…`);
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    log(`Navigating to ${courseUrl}`);
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/login/') || currentUrl.includes('/enrol/')) {
      if (!headed) {
        throw new Error(
          'Redirected to login/enrol — session cookie is expired or missing.\n' +
          (cfg.cookiesFromBrowser
            ? `Make sure you are logged in to ${hostnameFromUrl(courseUrl) ?? 'the course host'} in ${cfg.cookiesFromBrowser} and retry.`
            : 'Set "cookiesFromBrowser": "chrome" in config.json, or paste fresh cookies.')
        );
      }
      log('Login required — please log in in the browser window that opened (waiting up to 5 min)…');
      // Poll until the browser has left the login/SSO pages (waitForURL chokes on ERR_ABORTED mid-SSO)
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1500);
        const u = page.url();
        if (!u.includes('/login/') && !u.includes('/enrol/') && !u.includes('microsoftonline')) break;
      }
      if (page.url().includes('/login/') || page.url().includes('/enrol/') || page.url().includes('microsoftonline')) {
        throw new Error('Login timeout — 5 minutes elapsed without completing login.');
      }
      await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    log('Scanning for video activities…');

    const activityLinks = await page.evaluate(() => {
      const items = document.querySelectorAll('li.activity.modtype_videostream');
      return Array.from(items).map((li) => {
        const a = li.querySelector('a[href]');
        const nameEl = li.querySelector('[data-activityname]');
        const title = (
          nameEl?.getAttribute('data-activityname') ??
          nameEl?.textContent?.trim() ??
          a?.textContent?.trim() ??
          a?.href ?? ''
        ).replace(/\s+/g, ' ').trim();
        return { title, href: a?.href ?? null };
      }).filter(item => item.href);
    });

    log(`Found ${activityLinks.length} video activity link(s).`);

    for (let i = 0; i < activityLinks.length; i++) {
      const { title, href } = activityLinks[i];
      const index = String(i + 1).padStart(3, '0');
      log(`  [${index}/${activityLinks.length}] ${title}`);

      try {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const mp4Url = await page.evaluate(() => {
          const src = document.querySelector("source[type='video/mp4']");
          return src?.src ?? src?.getAttribute('src') ?? null;
        });

        if (!mp4Url) {
          log(`         [warn] No MP4 source found — skipping.`);
          manifest.push({ index, title, activityUrl: href, mp4Url: null, filename: null, error: 'no_mp4_found' });
          continue;
        }

        const moduleId = new URL(href).searchParams.get('id') ?? `x${i}`;
        const filename = `${index}-${moduleId}-${slugify(title)}.mp4`;
        log(`         → ${filename}`);
        manifest.push({ index, title, activityUrl: href, mp4Url, filename });
      } catch (err) {
        log(`         [error] ${err.message}`);
        manifest.push({ index, title, activityUrl: href, mp4Url: null, filename: null, error: err.message });
      }
    }
  } finally {
    // Resource cleanup on every path, success or error. Prevents Chromium zombie processes.
    await browser.close().catch(() => {});
  }

  ensureDir(paths.manifests);
  const courseId = new URL(courseUrl).searchParams.get('id') ?? slugify(courseUrl).slice(0, 20);
  const manifestPath = join(paths.manifests, `${courseId}-${Date.now()}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`Manifest saved → ${manifestPath}`);

  return { manifest, manifestPath };
}

// ─── Download ─────────────────────────────────────────────────────────────────

const MAX_REDIRECT_HOPS = 5;
// Private/link-local ranges + loopback. Blocks SSRF via malicious redirect.
const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./, /^::1$/, /^localhost$/i,
  /^0\./, /^fc[0-9a-f]{2}:/i, /^fe80:/i,
];

function isSafeDownloadTarget(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (PRIVATE_IP_PATTERNS.some(p => p.test(u.hostname))) return false;
  return true;
}

function downloadFile(url, destPath, hops = 0) {
  return new Promise((resolve, reject) => {
    if (existsSync(destPath)) {
      log(`    [skip] Already exists: ${basename(destPath)}`);
      return resolve(destPath);
    }
    if (hops > MAX_REDIRECT_HOPS) return reject(new Error(`Too many redirects (>${MAX_REDIRECT_HOPS}) for ${url}`));
    if (!isSafeDownloadTarget(url)) return reject(new Error(`Refusing to download from unsafe URL (private/loopback/non-http): ${url}`));

    const proto = url.startsWith('https') ? https : http;
    const tmp = destPath + '.part';
    const file = createWriteStream(tmp);
    let finished = false;

    const cleanupPart = () => { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} };
    const fail = (err) => { if (finished) return; finished = true; try { file.close(); } catch {} cleanupPart(); reject(err); };

    const req = proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        try { file.close(); } catch {}
        cleanupPart();
        const next = res.headers.location ?? '';
        const absolute = next.startsWith('http') ? next : new URL(next, url).toString();
        return downloadFile(absolute, destPath, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return fail(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let received = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r    ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
            lastPct = pct;
          }
        }
      });
      res.on('error', fail);
      res.pipe(file);
      file.on('finish', () => {
        if (finished) return;
        finished = true;
        process.stdout.write('\n');
        file.close(() => { try { renameSync(tmp, destPath); resolve(destPath); } catch (e) { cleanupPart(); reject(e); } });
      });
      file.on('error', fail);
    });
    req.on('error', fail);
  });
}

async function downloadAll(manifest, paths) {
  ensureDir(paths.downloads);
  const results = { ok: [], failed: [] };
  for (const item of manifest) {
    if (!item.mp4Url || !item.filename) { results.failed.push({ ...item, reason: item.error ?? 'no_mp4_url' }); continue; }
    const destPath = join(paths.downloads, item.filename);
    log(`Downloading [${item.index}]: ${item.title}`);
    try {
      await downloadFile(item.mp4Url, destPath);
      item.localMp4 = destPath;
      results.ok.push(item);
    } catch (err) {
      log(`  [error] ${err.message}`);
      results.failed.push({ ...item, reason: err.message });
    }
  }
  log(`Downloads: ${results.ok.length} ok, ${results.failed.length} failed.`);
  return results;
}

// ─── Audio extraction ─────────────────────────────────────────────────────────

function extractAudio(item, paths, cfg) {
  const mp4Path = item.localMp4 ?? join(paths.downloads, item.filename);
  if (!existsSync(mp4Path)) return { ...item, audioError: `mp4 not found: ${mp4Path}` };

  const mp3Name = basename(mp4Path, extname(mp4Path)) + '.mp3';
  const mp3Path = join(paths.audio, mp3Name);

  if (existsSync(mp3Path)) { log(`  [skip] ${mp3Name}`); return { ...item, localMp3: mp3Path }; }

  ensureDir(paths.audio);
  log(`  Extracting → ${mp3Name}`);

  const result = spawnSync(
    'ffmpeg',
    ['-i', mp4Path, '-vn', '-acodec', cfg.ffmpeg.codec, '-q:a', String(cfg.ffmpeg.quality), '-y', mp3Path],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString?.() ?? '';
    return { ...item, audioError: `ffmpeg exit ${result.status}: ${stderr.slice(-200)}` };
  }
  return { ...item, localMp3: mp3Path };
}

async function extractAllAudio(items, paths, cfg) {
  const results = { ok: [], failed: [] };
  for (const item of items) {
    log(`Audio [${item.index ?? '?'}]: ${item.title}`);
    const updated = extractAudio(item, paths, cfg);
    if (updated.audioError) { log(`  [error] ${updated.audioError}`); results.failed.push(updated); }
    else results.ok.push(updated);
  }
  log(`Audio: ${results.ok.length} ok, ${results.failed.length} failed.`);
  return results;
}

// ─── NotebookLM upload ────────────────────────────────────────────────────────

function findNlm() {
  const home = process.env.HOME ?? '';
  for (const candidate of ['nlm', `${home}/.local/bin/nlm`, '/opt/homebrew/bin/nlm', '/usr/local/bin/nlm']) {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return candidate; } catch {}
  }
  return null;
}

function loadUploadState(statePath) {
  if (!existsSync(statePath)) return { notebookId: null, sources: {} };
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    return { notebookId: parsed.notebookId ?? null, sources: parsed.sources ?? {} };
  } catch { return { notebookId: null, sources: {} }; }
}

function saveUploadState(statePath, state) {
  ensureDir(dirname(statePath));
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function listNotebooks(nlm) {
  const result = spawnSync(nlm, ['notebook', 'list', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`nlm notebook list failed (exit ${result.status}): ${(result.stderr ?? '').slice(-400)}`);
  }
  try { return JSON.parse(result.stdout ?? '[]'); } catch { return []; }
}

function findNotebookIdByTitle(nlm, title) {
  const items = listNotebooks(nlm);
  // nlm JSON shape is {id, title, ...}. Pick the newest matching one.
  const matches = items.filter(n => (n.title ?? '').trim() === title.trim());
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.updated ?? b.created ?? 0) - new Date(a.updated ?? a.created ?? 0));
  return matches[0].id ?? matches[0].notebook_id ?? null;
}

function createNotebook(nlm, title) {
  const result = spawnSync(nlm, ['notebook', 'create', title], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`nlm notebook create failed (exit ${result.status}): ${(result.stderr ?? '').slice(-400)}`);
  }
  // Authoritative path: list-by-title. Dropping the old stdout-regex fallback entirely;
  // it could silently bind to a wrong 20-char token from a version string or error text.
  const id = findNotebookIdByTitle(nlm, title);
  if (id) return id;
  throw new Error(
    `nlm notebook create succeeded but no notebook with title "${title}" appeared in \`nlm notebook list\`.\n` +
    `Run \`nlm notebook list\` manually, then re-run with --notebook <id> or set notebookId in config.`
  );
}

/**
 * Sanitise a title before passing it as a CLI argument. Even though spawnSync
 * uses argv (no shell), a title that starts with `--` or contains newlines
 * can be misinterpreted as a new flag by the receiving CLI, which is the
 * classic argv-injection pattern. Strip leading dashes and control chars.
 */
function sanitiseCliTitle(title, fallback = 'Untitled') {
  const cleaned = String(title ?? '')
    .replace(/[\r\n\t\0]/g, ' ')
    .replace(/^-+/, '')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : fallback;
}

async function uploadToNotebookLM(items, paths, cfg) {
  const nb = cfg.notebooklm ?? {};
  if (!nb.enabled) { log('NotebookLM upload disabled in config — skipping.'); return { ok: [], failed: [], skipped: true, notebookId: null }; }

  const uploadItems = items.filter(i => i.localMp3 && existsSync(i.localMp3));
  if (uploadItems.length === 0) { log('No MP3s to upload.'); return { ok: [], failed: [], skipped: true, notebookId: null }; }

  const nlm = findNlm();
  if (!nlm) {
    log('[warn] nlm CLI not found on PATH. Install it or run `nlm login` first. Skipping upload.');
    return { ok: [], failed: uploadItems.map(i => ({ ...i, uploadError: 'nlm not installed' })), skipped: true, notebookId: null };
  }

  const statePath = nb.uploadsStatePath
    ? (nb.uploadsStatePath.startsWith('./') ? join(__dirname, nb.uploadsStatePath.slice(2)) : nb.uploadsStatePath)
    : join(paths.manifests, 'uploads.json');

  const state = loadUploadState(statePath);
  let notebookId = state.notebookId ?? nb.reuseNotebookId ?? null;
  if (!notebookId) {
    const title = sanitiseCliTitle(nb.notebookTitle ?? 'BIU Course Lectures', 'BIU Course Lectures');
    log(`Creating NotebookLM notebook: "${title}"`);
    try {
      notebookId = createNotebook(nlm, title);
    } catch (e) {
      log(`[error] Could not create/resolve NotebookLM notebook: ${e.message}`);
      log('[warn] Skipping upload. Audio files remain in ' + paths.audio + '.');
      return { ok: [], failed: uploadItems.map(i => ({ ...i, uploadError: e.message })), skipped: true, notebookId: null };
    }
    state.notebookId = notebookId;
    saveUploadState(statePath, state);
    log(`  → notebook ID: ${notebookId}`);
  } else {
    log(`Reusing NotebookLM notebook: ${notebookId}`);
  }

  const waitTimeout = String(nb.waitTimeoutSeconds ?? 1800);
  const results = { ok: [], failed: [], skipped: false, notebookId };

  for (const item of uploadItems) {
    const mp3 = item.localMp3;
    if (state.sources[mp3]) { log(`  [skip] Already uploaded: ${basename(mp3)}`); results.ok.push(item); continue; }

    const cliTitle = sanitiseCliTitle(item.title || basename(mp3, '.mp3'), basename(mp3, '.mp3'));
    log(`Uploading [${item.index ?? '?'}] ${basename(mp3)}  (waiting up to ${waitTimeout}s)`);
    const args = [
      'source', 'add', notebookId,
      '--file', mp3,
      '--title', cliTitle,
      '--wait', '--wait-timeout', waitTimeout,
    ];
    const run = spawnSync(nlm, args, { stdio: 'inherit' });
    if (run.status !== 0) {
      log(`  [error] nlm source add exit ${run.status}`);
      results.failed.push({ ...item, uploadError: `nlm source add exit ${run.status}` });
      continue;
    }
    state.sources[mp3] = { title: item.title, uploadedAt: new Date().toISOString() };
    saveUploadState(statePath, state);
    results.ok.push(item);
  }

  log(`Uploads: ${results.ok.length} ok, ${results.failed.length} failed.`);
  log(`Notebook: https://notebooklm.google.com/notebook/${notebookId}`);
  return results;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

function verify(manifest, downloadResults, audioResults, uploadResults, paths) {
  console.log('\n══════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════');
  console.log(`  Activities discovered : ${manifest.length}`);
  console.log(`  With MP4 URL         : ${manifest.filter(m => m.mp4Url).length}`);
  console.log(`  MP4s downloaded      : ${downloadResults.ok.length}`);
  console.log(`  MP3s extracted       : ${audioResults.ok.length}`);
  console.log(`  Uploaded to NotebookLM: ${uploadResults.ok.length}${uploadResults.skipped ? ' (skipped)' : ''}`);

  const failures = [
    ...manifest.filter(m => !m.mp4Url).map(m => ({ title: m.title, reason: m.error ?? 'no_mp4_found' })),
    ...downloadResults.failed.map(m => ({ title: m.title, reason: `download: ${m.reason}` })),
    ...audioResults.failed.map(m => ({ title: m.title, reason: `audio: ${m.audioError}` })),
    ...uploadResults.failed.map(m => ({ title: m.title, reason: `upload: ${m.uploadError}` })),
  ];

  if (failures.length > 0) {
    console.log(`\n  FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`    ✗ ${f.title} — ${f.reason}`);
  } else {
    console.log('\n  All items processed successfully.');
  }

  console.log(`\n  Audio files → ${paths.audio}`);
  if (uploadResults.notebookId) {
    console.log(`  NotebookLM  → https://notebooklm.google.com/notebook/${uploadResults.notebookId}`);
  }
  console.log('══════════════════════════════════════════\n');
  return failures;
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const cfg = loadConfig(args.configPath);
  const course = resolveCourse(cfg, args);
  const paths = resolveOutputPaths(cfg, course.id);
  const courseUrl = course.url;

  // Stamp the resolved notebook ID into cfg so uploadToNotebookLM picks it up
  cfg.notebooklm = {
    ...(cfg.notebooklm ?? {}),
    reuseNotebookId: course.notebookId ?? cfg.notebooklm?.reuseNotebookId ?? null,
    notebookTitle: course.title,
    uploadsStatePath: join(paths.manifests, 'uploads.json'),
  };

  log(`Course : ${course.title} (${course.id})`);
  log(`URL    : ${courseUrl}`);
  log(`Notebook: ${cfg.notebooklm.reuseNotebookId ?? '(will create new)'}`);
  log(`Output : ${paths.downloads.replace(__dirname, '.')} | ${paths.audio.replace(__dirname, '.')} | ${paths.manifests.replace(__dirname, '.')}`);
  log(`Step   : ${args.step}`);

  let manifest = [];
  let downloadResults = { ok: [], failed: [] };
  let audioResults = { ok: [], failed: [] };
  let uploadResults = { ok: [], failed: [], skipped: true, notebookId: null };

  if (args.step === 'discover' || args.step === 'all') {
    ({ manifest } = await discover(cfg, paths, courseUrl, args.headed));
  } else {
    ensureDir(paths.manifests);
    const courseId = new URL(courseUrl).searchParams.get('id') ?? 'course';
    const files = readdirSync(paths.manifests)
      .filter(f => f.startsWith(courseId) && f.endsWith('.json') && f !== 'uploads.json')
      .sort();
    if (files.length === 0) { console.error(`No manifest for course ${courseId}. Run --step discover first.`); process.exit(1); }
    const manifestPath = join(paths.manifests, files[files.length - 1]);
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    log(`Loaded manifest: ${manifestPath} (${manifest.length} items)`);
  }

  if (args.step === 'download' || args.step === 'all') {
    downloadResults = await downloadAll(manifest, paths);
  }

  if (args.step === 'audio' || args.step === 'all') {
    let audioItems = downloadResults.ok;
    if (args.step === 'audio') {
      audioItems = manifest.filter(m => m.filename).map(m => ({ ...m, localMp4: join(paths.downloads, m.filename) })).filter(m => existsSync(m.localMp4));
      downloadResults = { ok: audioItems, failed: [] };
    }
    audioResults = await extractAllAudio(audioItems, paths, cfg);
  }

  if (args.step === 'upload' || args.step === 'all') {
    let uploadItems = audioResults.ok;
    if (args.step === 'upload') {
      uploadItems = manifest
        .filter(m => m.filename)
        .map(m => ({
          ...m,
          localMp4: join(paths.downloads, m.filename),
          localMp3: join(paths.audio, basename(m.filename, extname(m.filename)) + '.mp3'),
        }))
        .filter(m => existsSync(m.localMp3));
      log(`Loaded ${uploadItems.length} MP3(s) from ${paths.audio} for upload.`);
    }
    uploadResults = await uploadToNotebookLM(uploadItems, paths, cfg);
  }

  verify(manifest, downloadResults, audioResults, uploadResults, paths);
}

main().catch(err => { console.error('\n[fatal]', err.message); process.exit(1); });
