/**
 * Rebuilds assets/icon.ico from a source image: crops the fully transparent
 * border away so the artwork fills the frame, then writes a multi-size .ico
 * (16 … 256) so small renderings like the tray stay crisp instead of being
 * squashed down from 256px.
 *
 * Runs under Electron because nativeImage is the only image codec available
 * without adding dependencies:
 *
 *   npx electron tools/make-icon.js [source] [--margin=N] [--report]
 *
 * `source` defaults to assets/icon.ico (it rewrites in place).
 * `--margin=N` keeps N% of the cropped size as transparent padding (default 0).
 * `--report` measures and prints only, writing nothing.
 */
'use strict';

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// The Electron main process's stdout does not reach the terminal here, so
// failures have to be written somewhere visible.
const CRASH = path.join(__dirname, '..', 'icon-report.txt');
const die = (err) => {
  try {
    fs.writeFileSync(CRASH, ['CRASH', err && err.stack ? err.stack : String(err), ''].join('\n'));
  } catch {}
  app.exit(1);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const REPORT_ONLY = process.argv.includes('--report');
const MARGIN_PCT = Number(arg('margin', '0'));

/** Bounding box of pixels with any opacity at all. */
function opaqueBounds(image) {
  const { width, height } = image.getSize();
  const bmp = image.toBitmap(); // BGRA, 4 bytes per pixel
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bmp[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null; // fully transparent
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Grows a box to a square (icons are square) and clamps it to the canvas. */
function squareWithin(box, canvas, marginPct) {
  const pad = Math.round((Math.max(box.width, box.height) * marginPct) / 100);
  let side = Math.max(box.width, box.height) + pad * 2;
  side = Math.min(side, canvas.width, canvas.height);

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let x = Math.round(cx - side / 2);
  let y = Math.round(cy - side / 2);
  x = Math.max(0, Math.min(x, canvas.width - side));
  y = Math.max(0, Math.min(y, canvas.height - side));
  return { x, y, width: side, height: side };
}

/**
 * ICONDIR + one ICONDIRENTRY per image + the PNG payloads. PNG-compressed
 * entries are read by Windows Vista and later, which covers every target here.
 */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(() => {
  try {
  // Not app.getAppPath(): running a script under tools/ makes Electron report
  // that directory as the app path, which resolves every asset one level off.
  const root = path.join(__dirname, '..');
  const source = path.resolve(root, process.argv.find((a) => /\.(ico|png)$/i.test(a)) || 'assets/icon.ico');
  const target = path.join(root, 'assets', 'icon.ico');
  const log = [];

  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) {
    log.push(`ERROR: could not decode ${source}`);
    fs.writeFileSync(path.join(root, 'icon-report.txt'), log.join('\n') + '\n');
    app.exit(1);
    return;
  }

  const canvas = image.getSize();
  const box = opaqueBounds(image);
  if (!box) {
    log.push('ERROR: image is fully transparent');
    fs.writeFileSync(path.join(root, 'icon-report.txt'), log.join('\n') + '\n');
    app.exit(1);
    return;
  }

  const crop = squareWithin(box, canvas, MARGIN_PCT);
  const trimmedPct = (1 - (crop.width * crop.height) / (canvas.width * canvas.height)) * 100;
  const gain = canvas.width / crop.width;

  log.push(`source          ${source}`);
  log.push(`canvas          ${canvas.width}x${canvas.height}`);
  log.push(`opaque bounds   x=${box.x} y=${box.y} ${box.width}x${box.height}`);
  log.push(`  transparent margins  left ${box.x}  top ${box.y}` +
           `  right ${canvas.width - (box.x + box.width)}  bottom ${canvas.height - (box.y + box.height)}`);
  log.push(`crop (square)   x=${crop.x} y=${crop.y} ${crop.width}x${crop.height}  (margin ${MARGIN_PCT}%)`);
  log.push(`area trimmed    ${trimmedPct.toFixed(1)}%`);
  log.push(`artwork grows   ${gain.toFixed(2)}x`);

  if (REPORT_ONLY) {
    log.push('report only — nothing written');
  } else {
    const cropped = image.crop(crop);
    const pngs = SIZES.map((size) => ({
      size,
      data: cropped.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    }));
    const ico = buildIco(pngs);
    fs.writeFileSync(target, ico);
    log.push(`wrote           ${target}  ${ico.length} bytes`);
    log.push(`sizes           ${SIZES.join(', ')}`);
  }

  fs.writeFileSync(path.join(root, 'icon-report.txt'), log.join('\n') + '\n');
    app.exit(0);
  } catch (err) {
    die(err);
  }
});
