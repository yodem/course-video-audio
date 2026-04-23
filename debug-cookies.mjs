import { spawnSync, execFileSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';

let ytdlp = null;
for (const c of ['yt-dlp', `${process.env.HOME}/.pyenv/shims/yt-dlp`, '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
  try { execFileSync(c, ['--version'], { stdio: 'ignore' }); ytdlp = c; break; } catch {}
}
if (!ytdlp) { console.log('yt-dlp not found'); process.exit(1); }
console.log('Using yt-dlp:', ytdlp);

const tmpFile = join(os.tmpdir(), `debug-cookies-${Date.now()}.txt`);

const r = spawnSync(ytdlp, ['--cookies-from-browser', 'chrome', '--cookies', tmpFile, '--skip-download', 'https://lemida.biu.ac.il/'], { stdio: 'ignore' });
console.log('yt-dlp exit:', r.status);
console.log('file exists:', existsSync(tmpFile));

if (!existsSync(tmpFile)) { console.log('No cookie file produced'); process.exit(1); }

const lines = readFileSync(tmpFile, 'utf8').split('\n');
unlinkSync(tmpFile);

for (const line of lines) {
  if (line.startsWith('#') || !line.trim()) continue;
  const parts = line.split('\t');
  if (parts.length < 7) continue;
  const [cookieDomain, , cookiePath, secureStr, expiryStr, name, value] = parts;
  if (!name || !value) continue;
  if (!cookieDomain.includes('biu.ac.il')) continue;
  const expiry = parseInt(expiryStr, 10);
  const expires = expiry > 0 ? expiry : -1;
  console.log(JSON.stringify({ name: name.trim(), domain: cookieDomain.trim(), expires, expiryStr: expiryStr?.trim(), isNaN: isNaN(expiry) }));
}
