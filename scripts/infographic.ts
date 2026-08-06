/**
 * Render benchmark infographics from an aggregate file (scripts/aggregate.ts).
 * Emits self-contained HTML to --outdir; screenshot with scripts/shot.ts.
 *
 * Usage: npx tsx scripts/infographic.ts --group main-1 --outdir /tmp/x [--naive 1.75]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`missing --${name}`);
}

const group = arg('group');
const outdir = arg('outdir');
const naive = Number(arg('naive', '0')) || null;

interface Agg {
  models: {
    label: string;
    seeds: { seed: number; best: number }[];
    headline: number;
    tallest: number;
    meanFinal: number;
    meanPeak: number;
  }[];
}
const agg = JSON.parse(readFileSync(`replays/agg-${group}.json`, 'utf8')) as Agg;

const NAME: Record<string, string> = {
  'claude-opus-5': 'Claude Opus 5',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-fable-5': 'Claude Fable 5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.4-mini': 'GPT-5.4 mini',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'glm-5.2': 'GLM-5.2',
  k3: 'Kimi K3',
};
const COLOR: Record<string, string> = {
  claude: '#e08a63', // Anthropic coral
  gpt: '#6fc7b5', // OpenAI teal
  deepseek: '#7aa7e8',
  glm: '#9ad06e',
  k3: '#b48ae0',
};
const colorFor = (label: string): string =>
  COLOR[Object.keys(COLOR).find((p) => label.startsWith(p)) ?? ''] ?? '#999';

const REPO = 'github.com/eanderson4/llm-bench-tower-building';
const MAX_M = 12.5;
const pct = (m: number): string => `${(m / MAX_M) * 100}%`;

const shell = (title: string, body: string): string => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 1500px; background: #0f1216; color: #e8eaed;
    font-family: 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif; }
  .wrap { padding: 64px 72px 48px; height: 100%; display: flex; flex-direction: column; }
  h1 { font-size: 52px; letter-spacing: -0.5px; line-height: 1.1; }
  .sub { color: #9aa3ad; font-size: 24px; margin-top: 14px; line-height: 1.45; }
  .chart { flex: 1; margin-top: 44px; position: relative; }
  .footer { display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid #2a2f36; padding-top: 22px; margin-top: 36px; }
  .repo { font-size: 26px; font-weight: 700; color: #fff; }
  .lic { font-size: 20px; color: #6d7680; }
  .grid { position: absolute; inset: 0 40px 0 260px; }
  .gl { position: absolute; top: 0; bottom: 0; width: 1px; background: #232830; }
  .gl span { position: absolute; bottom: -30px; left: -14px; color: #5c656f; font-size: 18px; }
  .rows { position: absolute; inset: 0 40px 0 0; display: flex; flex-direction: column; justify-content: space-around; }
  .row { display: flex; align-items: center; height: 64px; position: relative; }
  .name { width: 260px; padding-right: 20px; text-align: right; font-size: 24px; color: #cfd5db; }
  .track { flex: 1; position: relative; height: 100%; }
  .bar { position: absolute; top: 14px; bottom: 14px; left: 0; border-radius: 0 6px 6px 0; opacity: 0.92; }
  .val { position: absolute; top: 50%; transform: translateY(-50%); font-size: 24px; font-weight: 700; margin-left: 14px; }
  .dot { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%;
    background: #0f1216; border: 2px solid rgba(255,255,255,0.85); transform: translate(-50%,-50%); }
  .floor { position: absolute; top: -6px; bottom: -6px; width: 0; border-left: 2px dashed #f2c14e; }
  .floor span { position: absolute; top: -34px; left: -8px; transform: translateX(-50%); white-space: nowrap;
    color: #f2c14e; font-size: 19px; }
  .note { font-size: 21px; color: #9aa3ad; margin-top: 30px; line-height: 1.5; }
  .note b { color: #e8eaed; }
  /* dumbbell */
  .db-line { position: absolute; top: 50%; height: 4px; transform: translateY(-50%);
    background: linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05)); }
  .pk { position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%;
    border: 3px solid #88929c; background: transparent; transform: translate(-50%,-50%); }
  .fn { position: absolute; top: 50%; width: 20px; height: 20px; border-radius: 50%; transform: translate(-50%,-50%); }
  .gap { position: absolute; top: 4px; font-size: 19px; color: #88929c; transform: translateX(-50%); }
  .legend { display: flex; gap: 36px; margin-top: 26px; font-size: 21px; color: #9aa3ad; align-items: center; }
  .legend .pk, .legend .fn { position: static; transform: none; display: inline-block; vertical-align: -3px; margin-right: 10px; }
</style>
<div class="wrap">${body}</div>`;

const gridLines = [0, 2, 4, 6, 8, 10, 12]
  .map((m) => `<div class="gl" style="left:${pct(m)}"><span>${m}m</span></div>`)
  .join('');

// ---- #1 leaderboard ----------------------------------------------------
const rows1 = agg.models
  .map((m) => {
    const dots = m.seeds
      .map((s) => `<div class="dot" style="left:${pct(s.best)}"></div>`)
      .join('');
    const valX = Math.max(m.headline, ...m.seeds.map((s) => s.best)) + 0.15;
    return `<div class="row"><div class="name">${NAME[m.label] ?? m.label}</div><div class="track">
      <div class="bar" style="width:${pct(m.headline)};background:${colorFor(m.label)}"></div>${dots}
      <div class="val" style="left:${pct(valX)}">${m.headline.toFixed(2)}</div>
    </div></div>`;
  })
  .join('');
const floor1 = naive
  ? `<div class="floor" style="left:${pct(naive)}"><span>scripted baseline ${naive.toFixed(2)}m</span></div>`
  : '';
writeFileSync(
  join(outdir, 'leaderboard.html'),
  shell(
    'Leaderboard',
    `<h1>Which LLM builds the tallest tower?</h1>
     <div class="sub">30 blocks, physics simulated, placements land with position/velocity noise —
     precise position or precise velocity, never both. Score is what's <b>still standing</b> at the end.
     Bar = mean over 5 seeds of the best of 3 attempts; dots = the 5 seeds.</div>
     <div class="chart"><div class="grid">${gridLines}${floor1}</div>
       <div class="rows">${rows1}</div></div>
     <div class="note"><b>Claude Opus 5</b> won by ending an attempt early to protect an 11.07m tower —
     it used only 15 of its 30 blocks. <b>Claude Sonnet 5</b> built the tallest single tower: 11.94m.</div>
     <div class="footer"><div class="repo">${REPO}</div><div class="lic">benchmark main-1 · MIT · replays + code in repo</div></div>`,
  ),
);

// ---- #2 peak vs final ---------------------------------------------------
const rows2 = agg.models
  .map((m) => {
    const gap = m.meanPeak - m.meanFinal;
    const mid = (m.meanPeak + m.meanFinal) / 2;
    return `<div class="row"><div class="name">${NAME[m.label] ?? m.label}</div><div class="track">
      <div class="db-line" style="left:${pct(m.meanFinal)};width:calc(${pct(gap)})"></div>
      <div class="pk" style="left:${pct(m.meanPeak)}"></div>
      <div class="fn" style="left:${pct(m.meanFinal)};background:${colorFor(m.label)}"></div>
      ${gap > 0.45 ? `<div class="gap" style="left:${pct(mid)}">&minus;${gap.toFixed(1)}m</div>` : ''}
    </div></div>`;
  })
  .join('');
writeFileSync(
  join(outdir, 'peakfinal.html'),
  shell(
    'Peak vs final',
    `<h1>Building tall is easy.<br>Stopping is hard.</h1>
     <div class="sub">Mean tallest point reached vs what was still standing when the attempt ended —
     only the survivor counts. The gap is towers the model built and then knocked down itself.</div>
     <div class="legend"><span><span class="pk"></span>peak height reached</span>
       <span><span class="fn" style="background:#e08a63"></span>final standing height (scored)</span></div>
     <div class="chart"><div class="grid">${gridLines}</div><div class="rows">${rows2}</div></div>
     <div class="note"><b>GPT-5.6 Sol</b> reached 7.9m in 4 of 5 seeds — and toppled its own tower late almost
     every time (mean 3.5m lost). <b>Claude Opus 5</b> banked instead: it ended attempts early to keep what it had.</div>
     <div class="footer"><div class="repo">${REPO}</div><div class="lic">benchmark main-1 · MIT · replays + code in repo</div></div>`,
  ),
);
console.log(`wrote ${outdir}/leaderboard.html, ${outdir}/peakfinal.html`);
