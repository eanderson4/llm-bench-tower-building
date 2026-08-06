/**
 * Headless video capture of the race page. Steps the deterministic replay
 * frame-by-frame via the page's ?capture=1 hooks and screenshots each frame,
 * then assemble with ffmpeg (see scripts/capture.sh for the full pipeline).
 *
 * Usage:
 *   npx tsx scripts/capture.ts --url "http://localhost:5175/src/race/?capture=1&replays=/replays/x.json&labels=Fable 5" \
 *     --out /tmp/frames --step 3 [--width 720] [--height 960] [--max-shots 1200]
 */
import { mkdirSync } from 'fs';
import puppeteer from 'puppeteer-core';

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`missing --${name}`);
}

const url = arg('url');
const outDir = arg('out');
const width = Number(arg('width', '720'));
const height = Number(arg('height', '960'));
let step = Number(arg('step', '3'));
const maxShots = Number(arg('max-shots', '1200'));

mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction('window.__race !== undefined', { timeout: 300000 });
  const maxFrames = (await page.evaluate('window.__race.maxFrames')) as number;
  if (Math.ceil(maxFrames / step) > maxShots) {
    step = Math.ceil(maxFrames / maxShots);
    console.log(`step raised to ${step} to stay under ${maxShots} shots`);
  }
  console.log(`maxFrames=${maxFrames} step=${step} -> ${Math.ceil(maxFrames / step)} shots`);

  let shot = 0;
  for (let i = 0; i < maxFrames; i += step) {
    await page.evaluate(`window.__race.goto(${Math.min(i, maxFrames - 1)})`);
    await page.screenshot({ path: `${outDir}/f${String(shot).padStart(5, '0')}.png` });
    shot++;
    if (shot % 100 === 0) console.log(`${shot} shots...`);
  }
  // Hold the final frame for ~1.5s of output video.
  await page.evaluate(`window.__race.goto(${maxFrames - 1})`);
  for (let k = 0; k < 45; k++) {
    await page.screenshot({ path: `${outDir}/f${String(shot).padStart(5, '0')}.png` });
    shot++;
  }
  console.log(`done: ${shot} frames -> ${outDir}`);
} finally {
  await browser.close();
}
