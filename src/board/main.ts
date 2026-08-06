interface BoardRow {
  model: string;
  challenge: string;
  group: string;
  attempt: number;
  seed: number;
  height: number;
  peakHeight: number;
  placements: number;
  endReason: string;
  replay: string;
  runId: string;
  mtime: number;
}

interface Manifest {
  generatedAt: string;
  rows: BoardRow[];
}

const metaEl = document.getElementById('meta')!;
const chipsEl = document.getElementById('chips')!;
const tableEl = document.getElementById('table')!;

let rows: BoardRow[] = [];
let challengeFilter = 'all';
let groupFilter = 'all';
let sortKey: keyof BoardRow = 'height';
let sortDir = -1;

const COLUMNS: Array<{ key: keyof BoardRow; label: string; num?: boolean }> = [
  { key: 'model', label: 'model' },
  { key: 'challenge', label: 'challenge' },
  { key: 'group', label: 'group' },
  { key: 'attempt', label: 'att', num: true },
  { key: 'seed', label: 'seed', num: true },
  { key: 'height', label: 'height', num: true },
  { key: 'peakHeight', label: 'peak', num: true },
  { key: 'placements', label: 'blocks', num: true },
  { key: 'endReason', label: 'ended' },
  { key: 'mtime', label: 'when' },
];

function viewerUrl(row: BoardRow): string {
  return `/src/viewer/?replay=${encodeURIComponent(row.replay)}`;
}

function chipRow(label: string, values: string[], active: string, onPick: (v: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  const tag = document.createElement('span');
  tag.textContent = label;
  tag.style.color = '#8b98a5';
  row.appendChild(tag);
  for (const v of values) {
    const b = document.createElement('button');
    b.className = `chip${v === active ? ' active' : ''}`;
    b.textContent = v === '' ? '(untagged)' : v;
    b.addEventListener('click', () => onPick(v));
    row.appendChild(b);
  }
  return row;
}

function render(): void {
  const challenges = [...new Set(rows.map((r) => r.challenge))].sort();
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  chipsEl.replaceChildren(
    chipRow('challenge', ['all', ...challenges], challengeFilter, (v) => {
      challengeFilter = v;
      render();
    }),
  );
  if (groups.length > 1) {
    chipsEl.appendChild(
      chipRow('group', ['all', ...groups], groupFilter, (v) => {
        groupFilter = v;
        render();
      }),
    );
  }

  const bestByChallenge = new Map<string, number>();
  for (const r of rows) bestByChallenge.set(r.challenge, Math.max(bestByChallenge.get(r.challenge) ?? 0, r.height));

  const visible = rows
    .filter((r) => (challengeFilter === 'all' || r.challenge === challengeFilter) && (groupFilter === 'all' || r.group === groupFilter))
    .sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir * cmp;
    });

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = col.label + (sortKey === col.key ? (sortDir < 0 ? ' ↓' : ' ↑') : '');
    th.addEventListener('click', () => {
      if (sortKey === col.key) sortDir = -sortDir;
      else {
        sortKey = col.key;
        sortDir = col.num ? -1 : 1;
      }
      render();
    });
    head.appendChild(th);
  }
  const thLink = document.createElement('th');
  thLink.textContent = 'replay';
  head.appendChild(thLink);
  table.appendChild(head);

  for (const r of visible) {
    const tr = document.createElement('tr');
    if (r.height === bestByChallenge.get(r.challenge) && r.height > 0) tr.className = 'best';
    const cells: string[] = [
      r.model,
      r.challenge,
      r.group,
      String(r.attempt),
      String(r.seed),
      `${r.height.toFixed(3)}m`,
      `${r.peakHeight.toFixed(3)}m`,
      String(r.placements),
      r.endReason,
      new Date(r.mtime).toLocaleString(),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (COLUMNS[i]!.num) td.className = 'num';
      tr.appendChild(td);
    });
    const td = document.createElement('td');
    const a = document.createElement('a');
    a.href = viewerUrl(r);
    a.textContent = 'watch';
    td.appendChild(a);
    tr.appendChild(td);
    table.appendChild(tr);
  }

  tableEl.replaceChildren(table);
}

async function main(): Promise<void> {
  const res = await fetch('/replays/index.json');
  if (!res.ok) {
    metaEl.innerHTML = `<span class="err">no /replays/index.json yet.\nRun some agents (npm run bench / npm run agent:naive) or rebuild the manifest: npm run board</span>`;
    return;
  }
  const data = (await res.json()) as Manifest;
  rows = data.rows.map((r) => ({ ...r, group: r.group ?? '' })); // older manifests lack group
  metaEl.textContent = `${rows.length} attempts indexed · generated ${new Date(data.generatedAt).toLocaleString()} · heights are settled supported-chain height (gold = best per challenge)`;
  render();
}

main().catch((err) => {
  metaEl.innerHTML = `<span class="err">${err instanceof Error ? err.message : String(err)}</span>`;
});
