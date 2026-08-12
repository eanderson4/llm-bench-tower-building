/**
 * Screenshot the final settled frame of a replay via the race page's capture
 * hooks (camera eased onto the finished tower).
 *
 * Usage: npx tsx scripts/final-frame.ts <race-capture-url> <out.png> <width> <height>
 */
import puppeteer from 'puppeteer-core';

const [url, out, w, h] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH
    ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'),
  headless: true,
  protocolTimeout: 600000,
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'],
  defaultViewport: { width: Number(w), height: Number(h), deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction('window.__race !== undefined', { timeout: 300000 });
  // repeat the final frame so the eased camera settles on the full tower
  await page.evaluate('(() => { const r = window.__race; for (let k = 0; k < 400; k++) r.goto(r.maxFrames - 1); })()');
  await page.screenshot({ path: out as `${string}.png` });
  console.log('wrote', out);
} finally {
  await browser.close();
}
