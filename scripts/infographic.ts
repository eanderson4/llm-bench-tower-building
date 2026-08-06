/**
 * Render benchmark infographics from an aggregate file (scripts/aggregate.ts).
 * Emits self-contained HTML to --outdir; screenshot with scripts/shot.ts.
 *
 * Usage:
 *   npx tsx scripts/infographic.ts --group main-1 --outdir /tmp/x \
 *     [--tower /abs/path/tower.png --towercap "11.94 m — Claude Sonnet 5, seed 14"]
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
// --towers "path|caption;path|caption;..." — small gallery beside the leaderboard
const towers = arg('towers', '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [path, cap] = s.split('|');
    return { path, cap };
  });

interface AggModel {
  label: string;
  seeds: { seed: number; best: number; heights?: number[] }[];
  headline: number;
  sd: number;
  tallest: number;
  meanFinal: number;
  meanPeak: number;
  attemptMeans: (number | null)[];
}
const agg = JSON.parse(readFileSync(`replays/agg-${group}.json`, 'utf8')) as { models: AggModel[] };

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
// Vendor hue families, distinct shade per model (matters for the slope chart).
const COLOR: Record<string, string> = {
  'claude-opus-5': '#ff8a4a',
  'claude-sonnet-5': '#e0a380',
  'claude-fable-5': '#c4674a',
  'claude-haiku-4-5-20251001': '#96603f',
  'gpt-5.5': '#6fc7b5',
  'gpt-5.6-sol': '#a5ded0',
  'gpt-5.4-mini': '#3f9484',
  'deepseek-v4-flash': '#7aa7e8',
  'glm-5.2': '#9ad06e',
  k3: '#b48ae0',
};
const colorFor = (label: string): string => COLOR[label] ?? '#999';

const MARK = (size: number): string => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
  <rect x="13" y="47" width="38" height="11" rx="2" fill="#aeb6bf"/>
  <rect x="18" y="34" width="28" height="11" rx="2" fill="#c3cad2"/>
  <rect x="22" y="21" width="20" height="11" rx="2" fill="#d8dde3"/>
  <g transform="rotate(-9 32 13)"><rect x="24" y="7" width="16" height="11" rx="2" fill="#f2c14e"/></g>
</svg>`;
const REPO = 'github.com/eanderson4/llm-bench-tower-building';
const MAX_M = 12.5;
const pct = (m: number): string => `${(m / MAX_M) * 100}%`;

const shell = (title: string, body: string): string => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 1500px; background: #0f1216; color: #e8eaed;
    font-family: 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif; }
  .wrap { padding: 48px 72px 44px; height: 100%; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
  .bname { font-size: 27px; font-weight: 800; letter-spacing: 0.5px; }
  .brun { margin-left: auto; font-size: 19px; color: #6d7680; }
  h1 { font-size: 50px; letter-spacing: -0.5px; line-height: 1.1; }
  .sub { color: #9aa3ad; font-size: 23px; margin-top: 14px; line-height: 1.45; }
  .main { flex: 1; display: flex; gap: 34px; margin-top: 36px; min-height: 0; }
  .chartcol { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .chart { flex: 1; position: relative; }
  .footer { display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid #2a2f36; padding-top: 20px; margin-top: 32px; }
  .repo { font-size: 19px; font-weight: 700; color: #fff; white-space: nowrap; }
  .lic { font-size: 17px; color: #6d7680; text-align: right; }
  .grid { position: absolute; inset: 0 96px 0 208px; }
  .gl { position: absolute; top: 0; bottom: 0; width: 1px; background: #232830; }
  .gl span { position: absolute; bottom: -28px; left: -13px; color: #5c656f; font-size: 17px; }
  .rows { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-around; }
  .row { display: flex; align-items: center; height: 60px; position: relative; }
  .name { width: 208px; padding-right: 18px; text-align: right; font-size: 22px; color: #cfd5db; }
  .track { flex: 1; position: relative; height: 100%; }
  .valcell { width: 96px; text-align: right; font-size: 23px; font-weight: 700; }
  .bar { position: absolute; top: 13px; bottom: 13px; left: 0; border-radius: 0 6px 6px 0; opacity: 0.92; }
  .whisker { position: absolute; top: 50%; height: 2px; transform: translateY(-50%); background: rgba(255,255,255,0.55); }
  .whisker::before, .whisker::after { content: ''; position: absolute; top: -6px; width: 2px; height: 14px;
    background: rgba(255,255,255,0.55); }
  .whisker::before { left: 0; } .whisker::after { right: 0; }
  .dot { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%;
    background: #0f1216; border: 2px solid rgba(255,255,255,0.85); transform: translate(-50%,-50%); }
  .towercol { width: 292px; display: flex; flex-direction: column; gap: 18px; }
  .towerhead { font-size: 21px; font-weight: 700; color: #cfd5db; }
  .towercol img { width: 100%; height: 268px; object-fit: contain; background: #101418;
    border-radius: 12px; border: 1px solid #2a2f36; display: block; }
  .towercap { font-size: 17px; color: #9aa3ad; line-height: 1.4; margin-top: 7px; }
  .towercap b { color: #e8eaed; }
  .note { font-size: 21px; color: #9aa3ad; margin-top: 26px; line-height: 1.5; }
  .note b { color: #e8eaed; }
  /* dumbbell */
  .db-line { position: absolute; top: 50%; height: 4px; transform: translateY(-50%);
    background: linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05)); }
  .pk { position: absolute; top: 50%; width: 18px; height: 18px; border-radius: 50%;
    border: 3px solid #88929c; background: transparent; transform: translate(-50%,-50%); }
  .fn { position: absolute; top: 50%; width: 20px; height: 20px; border-radius: 50%; transform: translate(-50%,-50%); }
  .gap { position: absolute; top: 2px; font-size: 19px; color: #88929c; transform: translateX(-50%); }
  .legend { display: flex; gap: 36px; margin-top: 24px; font-size: 21px; color: #9aa3ad; align-items: center; }
  .legend .pk, .legend .fn { position: static; transform: none; display: inline-block; vertical-align: -3px; margin-right: 10px; }
</style>
<div class="wrap">
  <div class="brand">${MARK(44)}<span class="bname">TowerBench</span><span class="brun">benchmark ${group}</span></div>
${body}</div>`;

const gridLines = [0, 2, 4, 6, 8, 10, 12]
  .map((m) => `<div class="gl" style="left:${pct(m)}"><span>${m}m</span></div>`)
  .join('');

// ---- #1 leaderboard ----------------------------------------------------
const rows1 = agg.models
  .map((m) => {
    const dots = m.seeds.map((s) => `<div class="dot" style="left:${pct(s.best)}"></div>`).join('');
    const lo = Math.max(0, m.headline - m.sd);
    const hi = Math.min(MAX_M, m.headline + m.sd);
    return `<div class="row"><div class="name">${NAME[m.label] ?? m.label}</div><div class="track">
      <div class="bar" style="width:${pct(m.headline)};background:${colorFor(m.label)}"></div>
      <div class="whisker" style="left:${pct(lo)};width:${pct(hi - lo)}"></div>${dots}
    </div><div class="valcell">${m.headline.toFixed(2)}</div></div>`;
  })
  .join('');
const towerCol = towers.length
  ? `<div class="towercol"><div class="towerhead">Example builds</div>${towers
      .map((t) => `<div><img src="${t.path}"><div class="towercap">${t.cap}</div></div>`)
      .join('')}</div>`
  : '';
writeFileSync(
  join(outdir, 'leaderboard.html'),
  shell(
    'Leaderboard',
    `<h1>Which LLM builds the tallest tower?</h1>
     <div class="sub">30 blocks, physics simulated, placements land with position/velocity noise —
     precise position or precise velocity, never both. Score is what's <b>still standing</b> at the end.
     Bar = mean over 5 seeds of the best of 3 attempts; dots = the 5 seeds; whisker = ±1 std dev.</div>
     <div class="main"><div class="chartcol"><div class="chart">
       <div class="grid">${gridLines}</div><div class="rows">${rows1}</div></div>
     <div class="note"><b>Claude Opus 5</b> won by ending an attempt early to protect an
     11.07m tower — it used only 15 of its 30 blocks.</div></div>${towerCol}</div>
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
    </div><div class="valcell"></div></div>`;
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
     <div class="main"><div class="chartcol"><div class="chart">
       <div class="grid">${gridLines}</div><div class="rows">${rows2}</div></div>
     <div class="note"><b>GPT-5.6 Sol</b> reached 7.9m in 4 of 5 seeds — and toppled its own tower late almost
     every time (mean 3.5m lost). <b>Claude Opus 5</b> banked instead: it ended attempts early to keep what it had.</div>
     </div></div>
     <div class="footer"><div class="repo">${REPO}</div><div class="lic">benchmark main-1 · MIT · replays + code in repo</div></div>`,
  ),
);

// ---- #3 learning: small multiples ---------------------------------------
// One panel per model: thick mean line over attempts 1..3, faint per-seed
// lines behind it, shared y scale for comparability.
const PW = 500;
const PH = 152;
const PPAD = { l: 44, r: 16, t: 12, b: 8 };
const ppx = (a: number): number => PPAD.l + ((a - 1) / 2) * (PW - PPAD.l - PPAD.r);
const ppy = (h: number): number => PH - PPAD.b - (h / 12.5) * (PH - PPAD.t - PPAD.b);

const panels = agg.models
  .map((m) => {
    const c = colorFor(m.label);
    const seedLines = m.seeds
      .map((s) =>
        s.heights
          ? `<polyline points="${s.heights.map((h, i) => `${ppx(i + 1)},${ppy(h)}`).join(' ')}"
               fill="none" stroke="${c}" stroke-width="1.5" opacity="0.3"/>`
          : '',
      )
      .join('');
    const meanPts = m.attemptMeans
      .map((h, i) => (h === null ? null : `${ppx(i + 1)},${ppy(h)}`))
      .filter(Boolean)
      .join(' ');
    const meanDots = m.attemptMeans
      .map((h, i) => (h === null ? '' : `<circle cx="${ppx(i + 1)}" cy="${ppy(h)}" r="5" fill="${c}"/>`))
      .join('');
    const grid = [0, 4, 8, 12]
      .map(
        (v) => `<line x1="${PPAD.l}" y1="${ppy(v)}" x2="${PW - PPAD.r}" y2="${ppy(v)}" stroke="#20252c"/>
          <text x="${PPAD.l - 8}" y="${ppy(v) + 5}" fill="#4e5760" font-size="13" text-anchor="end">${v}m</text>`,
      )
      .join('');
    const d = (m.attemptMeans[2] ?? 0) - (m.attemptMeans[0] ?? 0);
    const dTxt = `${d >= 0 ? '+' : '\u2212'}${Math.abs(d).toFixed(1)}m`;
    const dCol = d >= 0.3 ? '#7ec97e' : d <= -0.3 ? '#e06c6c' : '#8a939d';
    return `<div class="panel">
      <div class="phead"><span class="pname" style="color:${c}">${NAME[m.label] ?? m.label}</span>
        <span class="pdelta" style="color:${dCol}">${dTxt}</span></div>
      <svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">${grid}${seedLines}
        <polyline points="${meanPts}" fill="none" stroke="${c}" stroke-width="4"/>${meanDots}</svg>
    </div>`;
  })
  .join('');

writeFileSync(
  join(outdir, 'learning.html'),
  shell(
    'Learning',
    `<style>
      .panels { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 40px; margin-top: 30px; }
      .panel { display: flex; flex-direction: column; }
      .phead { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px 2px 44px; }
      .pname { font-size: 21px; font-weight: 700; }
      .pdelta { font-size: 19px; font-weight: 700; }
      .paxis { color: #4e5760; font-size: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
      .paxis div { display: flex; justify-content: space-between; padding-left: 44px; }
    </style>
     <h1>Do they learn between attempts?</h1>
     <div class="sub">3 attempts per seed; between attempts the conversation is wiped — all that survives
     is a notebook the model writes to itself. Thick line = mean final height per attempt;
     thin lines = each of the 5 seeds. Change shown is attempt 1 &rarr; 3.</div>
     <div class="panels">${panels}</div>
     <div class="paxis"><div><span>attempt 1</span><span>attempt 2</span><span>attempt 3</span></div><div><span>attempt 1</span><span>attempt 2</span><span>attempt 3</span></div></div>
     <div class="note"><b>Claude Opus 5</b> is the only model that improved on every attempt — its notes compound.
     <b>Kimi K3</b> wrote a wrong lesson into its notebook on attempt 1 ("never stand pillars upright") and plateaued.
     <b>Claude Sonnet 5</b> got worse every attempt: its peak was raw skill, not learning.</div>
     <div class="footer"><div class="repo">${REPO}</div><div class="lic">main-1 &middot; MIT</div></div>`,
  ),
);
// ---- #4 comparison table: TowerBench vs established benchmarks ----------
const EXT: Record<string, { aa: number | null; swe: number | null; arc: number | null; arcNote?: string }> = {
  'claude-opus-5': { aa: 61, swe: 96.0, arc: 90.4 },
  'claude-sonnet-5': { aa: 53, swe: 82.1, arc: null },
  'claude-fable-5': { aa: 60, swe: 95.0, arc: 89.2, arcNote: '\u00b9' },
  'gpt-5.5': { aa: 55, swe: 88.7, arc: 85.0, arcNote: '\u00b9' },
  'deepseek-v4-flash': { aa: 50, swe: 79.0, arc: null },
  'gpt-5.6-sol': { aa: 59, swe: 96.2, arc: 92.5, arcNote: '\u00b9' },
  'glm-5.2': { aa: 51, swe: null, arc: 22.8 },
  k3: { aa: 57, swe: 93.4, arc: 60.4 },
  'claude-haiku-4-5-20251001': { aa: 30, swe: 73.3, arc: 37.7, arcNote: '\u00b9' },
  'gpt-5.4-mini': { aa: 40, swe: 73.0, arc: 18.9, arcNote: '\u00b9' },
};
const cell = (v: number | null, max: number, unit: string, note = '', dp = 1): string => {
  if (v === null) return `<td class="na">\u2014</td>`;
  const w = Math.max(3, (v / max) * 100);
  return `<td><div class="cellbar" style="width:${w}%"></div><span>${v.toFixed(dp)}${unit}${note}</span></td>`;
};
const tRows = agg.models
  .map((m, i) => {
    const e = EXT[m.label] ?? { aa: null, swe: null, arc: null };
    return `<tr>
      <td class="rk">${i + 1}</td>
      <td class="mdl"><span class="chip" style="background:${colorFor(m.label)}"></span>${NAME[m.label] ?? m.label}</td>
      <td class="tb"><div class="cellbar tbbar" style="width:${(m.headline / 9) * 100}%"></div><span><b>${m.headline.toFixed(2)} m</b></span></td>
      ${cell(e.aa, 65, '', '', 0)}${cell(e.swe, 100, '')}${cell(e.arc, 100, '', e.arcNote ?? '')}
    </tr>`;
  })
  .join('');
writeFileSync(
  join(outdir, 'compare.html'),
  shell(
    'TowerBench vs other benchmarks',
    `<style>
      table { border-collapse: collapse; width: 100%; margin-top: 34px; }
      th { text-align: left; font-size: 19px; color: #8a939d; font-weight: 400; padding: 0 14px 12px;
           border-bottom: 1px solid #2a2f36; }
      th.col1 { color: #f2c14e; font-weight: 700; }
      td { position: relative; padding: 0 14px; height: 74px; font-size: 22px; border-bottom: 1px solid #1a1f26;
           vertical-align: middle; }
      td span { position: relative; }
      .rk { width: 44px; color: #5c656f; font-size: 19px; }
      .mdl { width: 250px; font-weight: 700; }
      .chip { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 10px; }
      .cellbar { position: absolute; left: 6px; top: 16px; bottom: 16px; background: #232b34; border-radius: 5px; }
      .tbbar { background: rgba(242,193,78,0.28); border: 1px solid rgba(242,193,78,0.45); }
      .tb b { color: #f2c14e; }
      .na { color: #4e5760; }
      .fno { font-size: 17px; color: #6d7680; margin-top: 14px; }
    </style>
     <h1>Strong coders, bad builders.</h1>
     <div class="sub">TowerBench (final standing tower height) next to the usual leaderboards.
     If tower building were just coding or abstract reasoning in disguise, the columns would agree.
     They don't.</div>
     <table>
       <tr><th></th><th>model</th><th class="col1">TowerBench main-1</th>
         <th>AA Intelligence Index</th><th>SWE-bench Verified %</th><th>ARC-AGI-2 %</th></tr>
       ${tRows}
     </table>
     <div class="fno">\u00b9 public-eval / aggregator figure, not ARC's semi-private set. \u2014 = no credible
     published number. External scores: vendor / Artificial Analysis / vals.ai / arcprize.org, Aug 2026,
     mixed reasoning configs \u2014 for eyeballing correlations only.</div>
     <div class="note"><b>GPT-5.6 Sol</b>: #1 column on SWE-bench, #6 tower. <b>Kimi K3</b>: 93 on SWE-bench,
     8th tower. Meanwhile <b>Claude Sonnet 5</b> out-builds models that out-score it everywhere else.
     Building under uncertainty is its own skill.</div>
     <div class="footer"><div class="repo">${REPO}</div><div class="lic">main-1 &middot; MIT</div></div>`,
  ),
);

console.log(`wrote ${outdir}/{leaderboard,peakfinal,learning}.html`);
