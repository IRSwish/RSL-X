import 'dotenv/config';
import { Client } from 'basic-ftp';
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';

const REPO_ROOT = process.cwd();
const MANIFEST_PATH = join(REPO_ROOT, '.deploy-manifest.json');
const MANIFEST_VERSION = 1;

const FLAGS = new Set(process.argv.slice(2));
const DRY_RUN = FLAGS.has('--dry-run');
const FULL = FLAGS.has('--full');
const BOOTSTRAP = FLAGS.has('--bootstrap');

const required = (DRY_RUN || BOOTSTRAP) ? ['UNLOCK_TOKEN'] : ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'UNLOCK_TOKEN'];
for (const k of required) {
  if (!process.env[k] || process.env[k].includes('PASTE_YOUR')) {
    console.error(`[deploy] Missing or unset env var: ${k}`);
    console.error(`[deploy] Edit .env and fill it in, then re-run.`);
    process.exit(1);
  }
}

const FTP_HOST = process.env.FTP_HOST;
const FTP_USER = process.env.FTP_USER;
const FTP_PASS = process.env.FTP_PASS;
const FTP_SECURE = process.env.FTP_SECURE !== 'false';
const UNLOCK_TOKEN = process.env.UNLOCK_TOKEN;
const REMOTE_ROOT = process.env.REMOTE_ROOT || '/www';

if (!/^[A-Za-z0-9-]+$/.test(UNLOCK_TOKEN)) {
  console.error(`[deploy] UNLOCK_TOKEN must be alphanumeric + dashes only.`);
  process.exit(1);
}

const EXCLUDE_PATTERNS = [
  /^\.git(\/|$)/,
  /^\.github(\/|$)/,
  /^\.claude(\/|$)/,
  /^\.vscode(\/|$)/,
  /^node_modules(\/|$)/,
  /^scripts(\/|$)/,
  /^memory(\/|$)/,
  /^MEMORY\.md$/,
  /(^|\/)\.env($|\.)/,
  /^\.env\.example$/,
  /^\.gitignore$/,
  /^\.deploy-manifest\.json$/,
  /\.psd$/i,
  /\.db$/i,
  /\.sqlite$/i,
  /^tmpclaude-/,
  /^vercel\.json$/,
  /^package(-lock)?\.json$/,
  /^dark_fantasy_frame.*\.html$/i,
  /^Ad_Banner\.psd$/,
];

const isExcluded = (rel) => EXCLUDE_PATTERNS.some((re) => re.test(rel));

async function* walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, rel);
    } else if (entry.isFile()) {
      yield { full, rel };
    }
  }
}

const HTACCESS = `<IfModule mod_rewrite.c>
RewriteEngine On
Options -Indexes

# The magic unlock URL serves the unlock helper page
RewriteRule ^_unlock_${UNLOCK_TOKEN}/?$ /_unlock.html [L]

# Exempt /xtender/ from gating — Velopack auto-update for RSL-Xtender
# fetches RELEASES / *.nupkg without any cookie. Keep before the gating
# rules so it short-circuits.
RewriteRule ^xtender/ - [L]

# If the unlock cookie is set, serve everything normally
RewriteCond %{HTTP_COOKIE} rslx_unlock=${UNLOCK_TOKEN}
RewriteRule ^ - [L]

# Otherwise: blank at root, gating helpers allowed, everything else 404
RewriteRule ^$ /_blank.html [L]
RewriteRule ^_blank\\.html$ - [L]
RewriteRule ^_unlock\\.html$ - [L]
RewriteRule ^ - [R=404,L]
</IfModule>

<IfModule mod_headers.c>
<Files "_blank.html">
  Header always set Cache-Control "no-store, must-revalidate"
</Files>
</IfModule>
`;

const BLANK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body></body></html>`;

const UNLOCK_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
<script>
document.cookie = "rslx_unlock=${UNLOCK_TOKEN}; path=/; max-age=2592000; SameSite=Lax";
window.location.replace("/?_=" + Date.now());
</script>
</head>
<body></body>
</html>
`;

const GATING_FILES = {
  '.htaccess': HTACCESS,
  '_blank.html': BLANK_HTML,
  '_unlock.html': UNLOCK_HTML,
};

async function loadManifest() {
  try {
    const data = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (data.version !== MANIFEST_VERSION) return { files: {}, gatingHash: '' };
    return data;
  } catch {
    return { files: {}, gatingHash: '' };
  }
}

async function saveManifest(manifest) {
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function hashGating() {
  return [UNLOCK_TOKEN, HTACCESS, BLANK_HTML, UNLOCK_HTML].join('\n').length + ':' + UNLOCK_TOKEN;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function ensureRemoteDir(client, dirCache, remoteDir) {
  if (dirCache.has(remoteDir)) {
    await client.cd(remoteDir);
    return;
  }
  await client.ensureDir(remoteDir);
  dirCache.add(remoteDir);
}

async function uploadString(client, dirCache, remotePath, content) {
  const slash = remotePath.lastIndexOf('/');
  const dir = slash > 0 ? remotePath.substring(0, slash) : '/';
  const name = remotePath.substring(slash + 1);
  await ensureRemoteDir(client, dirCache, dir);
  await client.uploadFrom(Readable.from(Buffer.from(content, 'utf8')), name);
}

async function main() {
  // Build local index
  const localFiles = [];
  for await (const f of walk(REPO_ROOT)) localFiles.push(f);
  localFiles.sort((a, b) => a.rel.localeCompare(b.rel));

  const localIndex = new Map();
  for (const f of localFiles) {
    const s = await stat(f.full);
    const rel = f.rel.split(sep).join('/');
    localIndex.set(rel, { full: f.full, mtime: s.mtimeMs, size: s.size });
  }

  // Load manifest
  const manifest = await loadManifest();
  const prevFiles = manifest.files || {};
  const prevGatingHash = manifest.gatingHash || '';
  const currentGatingHash = hashGating();

  // Diff
  const toUpload = [];
  const unchanged = [];
  for (const [rel, info] of localIndex) {
    const prev = prevFiles[rel];
    if (FULL || !prev || prev.mtime !== info.mtime || prev.size !== info.size) {
      toUpload.push({ rel, ...info });
    } else {
      unchanged.push(rel);
    }
  }
  const toDelete = [];
  for (const rel of Object.keys(prevFiles)) {
    if (!localIndex.has(rel)) toDelete.push(rel);
  }
  const gatingChanged = FULL || prevGatingHash !== currentGatingHash || prevGatingHash === '';

  const totalUploadBytes = toUpload.reduce((a, b) => a + b.size, 0);

  console.log(`[deploy] Plan:`);
  console.log(`[deploy]   upload    : ${toUpload.length.toString().padStart(5)} files (${fmtBytes(totalUploadBytes)})`);
  console.log(`[deploy]   delete    : ${toDelete.length.toString().padStart(5)} files`);
  console.log(`[deploy]   unchanged : ${unchanged.length.toString().padStart(5)} files (skipped)`);
  console.log(`[deploy]   gating    : ${gatingChanged ? 'rewrite' : 'unchanged (skipped)'}`);
  if (FULL) console.log(`[deploy]   --full flag: forcing all files`);

  if (DRY_RUN) {
    if (toUpload.length) {
      console.log(`[deploy] --dry-run: files that would be uploaded:`);
      for (const f of toUpload) console.log(`   + ${f.rel.padEnd(60)} ${fmtBytes(f.size)}`);
    }
    if (toDelete.length) {
      console.log(`[deploy] --dry-run: files that would be deleted from remote:`);
      for (const r of toDelete) console.log(`   - ${r}`);
    }
    return;
  }

  if (BOOTSTRAP) {
    const newFilesEntries = {};
    for (const [rel, info] of localIndex) {
      newFilesEntries[rel] = { mtime: info.mtime, size: info.size };
    }
    await saveManifest({ version: MANIFEST_VERSION, files: newFilesEntries, gatingHash: currentGatingHash });
    console.log(`[deploy] --bootstrap: wrote manifest for ${localIndex.size} files. Future deploys will be incremental.`);
    return;
  }

  if (!toUpload.length && !toDelete.length && !gatingChanged) {
    console.log(`[deploy] Nothing to do.`);
    return;
  }

  const client = new Client(60000);
  client.ftp.verbose = false;
  const dirCache = new Set();

  try {
    console.log(`[deploy] Connecting to ${FTP_HOST} (FTPS=${FTP_SECURE})...`);
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASS,
      secure: FTP_SECURE,
      secureOptions: { rejectUnauthorized: false },
    });
    console.log(`[deploy] Connected.`);

    // Uploads
    let lastDir = '';
    let uploadedBytes = 0;
    const newFilesEntries = { ...prevFiles };

    for (let i = 0; i < toUpload.length; i++) {
      const f = toUpload[i];
      const slash = f.rel.lastIndexOf('/');
      const subDir = slash >= 0 ? f.rel.substring(0, slash) : '';
      const remoteDir = subDir ? `${REMOTE_ROOT}/${subDir}` : REMOTE_ROOT;
      const remoteName = slash >= 0 ? f.rel.substring(slash + 1) : f.rel;

      if (remoteDir !== lastDir) {
        await ensureRemoteDir(client, dirCache, remoteDir);
        lastDir = remoteDir;
      }

      try {
        await client.uploadFrom(f.full, remoteName);
      } catch (e) {
        console.error(`\n[deploy] Failed to upload ${f.rel}: ${e.message}`);
        // Persist what we have so far
        await saveManifest({ version: MANIFEST_VERSION, files: newFilesEntries, gatingHash: prevGatingHash });
        throw e;
      }

      newFilesEntries[f.rel] = { mtime: f.mtime, size: f.size };
      uploadedBytes += f.size;

      const pct = Math.floor(((i + 1) / toUpload.length) * 100);
      const label = f.rel.length > 50 ? '...' + f.rel.slice(-47) : f.rel;
      process.stdout.write(`\r[deploy] up ${i + 1}/${toUpload.length} (${pct}%) ${label.padEnd(50)}`);
    }
    if (toUpload.length) process.stdout.write('\n');

    // Deletions
    for (let i = 0; i < toDelete.length; i++) {
      const rel = toDelete[i];
      const remotePath = `${REMOTE_ROOT}/${rel}`;
      try {
        await client.cd('/');
        await client.remove(remotePath);
        delete newFilesEntries[rel];
      } catch (e) {
        // File might already be gone — log but don't fail
        console.warn(`\n[deploy] Could not delete ${rel}: ${e.message}`);
        delete newFilesEntries[rel];
      }
      const label = rel.length > 50 ? '...' + rel.slice(-47) : rel;
      process.stdout.write(`\r[deploy] rm ${i + 1}/${toDelete.length} ${label.padEnd(50)}`);
    }
    if (toDelete.length) process.stdout.write('\n');

    // Gating files
    let newGatingHash = prevGatingHash;
    if (gatingChanged) {
      console.log(`[deploy] Writing gating files...`);
      for (const [name, content] of Object.entries(GATING_FILES)) {
        await uploadString(client, dirCache, `${REMOTE_ROOT}/${name}`, content);
      }
      newGatingHash = currentGatingHash;
    }

    // Save manifest
    await saveManifest({ version: MANIFEST_VERSION, files: newFilesEntries, gatingHash: newGatingHash });

    console.log(`[deploy] Done. Uploaded ${fmtBytes(uploadedBytes)}, deleted ${toDelete.length} file(s), ${unchanged.length} unchanged.`);
    if (gatingChanged) {
      console.log(`[deploy] Public URL : https://rsl-x.gg/`);
      console.log(`[deploy] Unlock URL : https://rsl-x.gg/_unlock_${UNLOCK_TOKEN}`);
    }
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('[deploy] FAILED:', err);
  process.exit(1);
});
