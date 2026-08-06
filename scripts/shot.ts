/**
 * Screenshot a local HTML file or URL at a fixed viewport — used to render
 * infographics (see scripts/infographic.ts) to PNG.
 *
 * Usage: npx tsx scripts/shot.ts --url file:///path/page.html --out out.png \
 *          [--width 1200] [--height 1500] [--scale 2]
 */
import puppeteer from 'puppeteer-core';

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`missing --${name}`);
}

const url = arg('url');
const out = arg('out');
const width = Number(arg('width', '1200'));
const height = Number(arg('height', '1500'));
const scale = Number(arg('scale', '2'));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'],
  defaultViewport: { width, height, deviceScaleFactor: scale },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out as `${string}.png` });
  console.log(`wrote ${out} (${width}x${height} @${scale}x)`);
} finally {
  await browser.close();
}
