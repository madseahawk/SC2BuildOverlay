'use strict';

/**
 * Fetches the step icons at the user's request, rather than shipping them.
 *
 * The pictures are extracted from the game's own files and remain Blizzard
 * Entertainment's work. Putting them inside the installer would mean copying
 * and distributing that artwork; fetching them on request means each machine
 * takes its own copy from the public source, the way running
 * `tools/fetch-icons.js` always did. What ships is `manifest.json` — the
 * Korean-term to filename mapping, which is this project's own work.
 *
 * Only the names already listed in the manifest are downloaded. Nothing here
 * discovers files or decides what an icon means; that stays in the dev tool.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO = 'BurnySc2/sc2-planner';
const REF = 'master';
const DIR = 'src/icons/png';
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}/${DIR}/`;

// Enough to keep the link busy without opening 196 sockets at once.
const CONCURRENCY = 6;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'sc2-build-overlay' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('시간 초과')));
  });
}

/** The image names a manifest refers to, each wanted once. */
function wantedFrom(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return [...new Set(Object.values(manifest.terms || {}))];
}

/**
 * Downloads every icon the manifest names into `dir`.
 *
 * @param onProgress called with { done, total } as files land
 * @returns { ok, downloaded, skipped, failed, message }
 *
 * A file that fails is counted and skipped rather than aborting the run: 195
 * of 196 icons is a working icon set with one gap, which is a far better
 * outcome than none at all. Only a manifest that cannot be read is fatal.
 */
async function downloadIcons({ manifestPath, dir, onProgress = () => {} }) {
  let wanted;
  try {
    wanted = wantedFrom(manifestPath);
  } catch (err) {
    return { ok: false, downloaded: 0, skipped: 0, failed: 0, message: `목록을 읽지 못했습니다: ${err.message}` };
  }

  fs.mkdirSync(dir, { recursive: true });

  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  const failed = [];

  const queue = wanted.slice();
  const worker = async () => {
    for (;;) {
      const base = queue.shift();
      if (!base) return;
      const target = path.join(dir, `${base}.png`);
      try {
        if (fs.existsSync(target)) {
          skipped += 1;
        } else {
          const buf = await get(RAW + encodeURIComponent(base) + '.png');
          // Written under a temporary name and moved into place, so an
          // interrupted download cannot leave a half file that later runs
          // would take for a complete one.
          const tmp = `${target}.part`;
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, target);
          downloaded += 1;
        }
      } catch (err) {
        failed.push(`${base}: ${err.message}`);
      }
      done += 1;
      onProgress({ done, total: wanted.length });
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    ok: failed.length === 0,
    downloaded,
    skipped,
    failed: failed.length,
    message: failed.length ? `${failed.length}개를 받지 못했습니다. 다시 시도해 보세요.` : null,
  };
}

module.exports = { downloadIcons, wantedFrom, SOURCE_URL: `https://github.com/${REPO}` };
