import { mkdirSync, writeFileSync } from 'node:fs';
import { getChallenge } from '../core/challenges';
import { AttemptRunner, parseSeeds, type AttemptSummary, type HarnessMode } from './attempts';
import { updateManifest } from './manifest';
import { KICKOFF, buildDebrief, buildKickoff, buildSystemPrompt } from './prompt';
import { NOTES_LIMIT, makeDriver, type ToolResultMsg } from './providers';

/**
 * Benchmark runner: drives one model through N attempts of a challenge.
 *
 * Modes (--mode):
 *   episodic (default) — fresh conversation per attempt; the model distills
 *     what it learned into a persistent notebook (update_notebook) before the
 *     reset. Live context stays bounded no matter how many attempts.
 *   session — one continuous conversation across all attempts (original
 *     behavior; context grows linearly with attempts).
 *
 * Usage:
 *   npx tsx src/harness/run.ts --model gpt-5.6-sol --challenge bricks --seeds 3x11
 *   npx tsx src/harness/run.ts --model claude-fable-5 --challenge mixed --seeds 11,12,13 --mode session
 */

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v === undefined || v.startsWith('--')) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return v;
}

const model = arg('model');
const challengeId = arg('challenge', 'bricks');
const seeds = parseSeeds(arg('seeds', '3x11'));
const maxTurns = Number(arg('max-turns', '120'));
const label = arg('label', model.replace(/[^a-z0-9.-]+/gi, '_'));
const group = arg('group', '');
const modeArg = arg('mode', 'episodic');
if (modeArg !== 'session' && modeArg !== 'episodic') throw new Error(`bad --mode "${modeArg}" (want session|episodic)`);
const mode: HarnessMode = modeArg;
const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

const challenge = getChallenge(challengeId);
const runner = new AttemptRunner(challengeId, seeds, label, runId, 'replays', group, mode);
const driver = makeDriver(model, buildSystemPrompt(challengeId, seeds.length, seeds[0], mode), KICKOFF);

interface TranscriptEntry {
  turn: number;
  text: string;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  usage: { input: number; output: number; context: number };
}
const transcript: TranscriptEntry[] = [];

function saveTranscript(): void {
  mkdirSync('replays', { recursive: true });
  writeFileSync(`replays/transcript-${label}-${challengeId}-${runId}.json`, JSON.stringify(transcript, null, 2));
}

function brief(v: unknown, max = 160): string {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

console.log(`model=${model} challenge=${challengeId} seeds=${seeds.join(',')} maxTurns=${maxTurns} mode=${mode}`);
console.log(`challenge: ${challenge.name} — ${challenge.inventory.length} blocks, K=${(challenge.noise.sigmaX0 * challenge.noise.sigmaV0).toPrecision(3)}`);

let pending: ToolResultMsg[] | undefined;
let idleTurns = 0;
let peakContext = 0;
let notebook = '';
let pendingDebrief: AttemptSummary | null = null;
const t0 = Date.now();

for (let turn = 1; turn <= maxTurns; turn++) {
  const t = await driver.step(pending);
  pending = undefined;

  const entry: TranscriptEntry = {
    turn,
    text: t.text,
    toolCalls: [],
    usage: { input: t.usage.input, output: t.usage.output, context: t.usage.contextTokens },
  };
  transcript.push(entry);
  peakContext = Math.max(peakContext, t.usage.contextTokens);
  if (t.text.trim()) console.log(`[t${turn}] ${t.text.trim().split('\n')[0]!.slice(0, 140)}`);

  if (t.toolCalls.length === 0) {
    if (runner.isFinished) break;
    idleTurns++;
    if (idleTurns >= 3) {
      if (pendingDebrief) {
        // Model declined to write notes — reset without them rather than deadlock.
        console.log('model declined update_notebook 3 turns in a row; resetting without new notes');
        runner.recordNotes(pendingDebrief.attempt, notebook);
        driver.reset(buildKickoff(runner.attempts, notebook, runner.attemptsTotal));
        pendingDebrief = null;
        idleTurns = 0;
        continue;
      }
      console.log('model stopped calling tools 3 turns in a row; ending run');
      break;
    }
    driver.pushUser(
      pendingDebrief
        ? 'Call update_notebook now — distill this attempt into your notebook before the context reset. Do not just describe; use the tool.'
        : 'Continue playing: call get_inventory / observe / place_block. Do not just describe — use the tools.',
    );
    continue;
  }
  idleTurns = 0;

  const results: ToolResultMsg[] = [];
  let contextReset = false;
  for (const call of t.toolCalls) {
    let result: unknown;
    if (call.name === 'update_notebook') {
      const raw = (call.args as { notes?: unknown } | null)?.notes;
      notebook = (typeof raw === 'string' ? raw : String(raw ?? '')).slice(0, NOTES_LIMIT);
      runner.recordNotes(pendingDebrief?.attempt ?? runner.attemptNumber, notebook);
      if (pendingDebrief) {
        // Attempt boundary: notes are saved, now discard the conversation.
        result = { ok: true, saved: `${notebook.length} chars`, note: 'Notebook saved; conversation resets now.' };
        entry.toolCalls.push({ name: call.name, args: call.args, result });
        console.log(`[t${turn}] update_notebook (${notebook.length} chars) -> context reset`);
        driver.reset(buildKickoff(runner.attempts, notebook, runner.attemptsTotal));
        pendingDebrief = null;
        contextReset = true;
        break; // any further calls this turn belonged to the discarded conversation
      }
      result = { ok: true, saved: `${notebook.length} chars` };
    } else if (pendingDebrief) {
      result = {
        ok: false,
        error: 'Attempt boundary: call update_notebook first — your notes are the only thing (besides the history table) carried into the next attempt.',
      };
    } else if (call.args !== null && typeof call.args === 'object' && '_parseError' in call.args) {
      result = { ok: false, error: `Tool arguments were not valid JSON: ${(call.args as { _parseError: string })._parseError}` };
    } else {
      result = await runner.handleTool(call.name, call.args);
    }
    results.push({ id: call.id, name: call.name, result });
    entry.toolCalls.push({ name: call.name, args: call.args, result });

    const r = result as Record<string, unknown>;
    if (call.name === 'place_block') {
      if (r.ok) {
        const settle = r.settle as { outcome: string; tower: { height: number } };
        const complete = r.episodeComplete as Record<string, unknown> | undefined;
        console.log(
          `[t${turn}] place ${(call.args as { blockId: string }).blockId} -> ${settle.outcome} h=${settle.tower.height.toFixed(3)}` +
            (complete ? `  | attempt done: ${brief(complete.finalizedAttempt ?? complete.message)}` : ''),
        );
      } else {
        console.log(`[t${turn}] place REJECTED: ${brief(r.error)}`);
      }
    } else {
      console.log(`[t${turn}] ${call.name}${r.ok === false ? ` -> error: ${brief(r.error)}` : ''}`);
    }

    if (mode === 'episodic' && !pendingDebrief) {
      const ec = (r.episodeComplete ?? (r.finalizedAttempt ? r : undefined)) as
        | { finalizedAttempt?: AttemptSummary; benchmarkComplete?: boolean }
        | undefined;
      if (ec?.finalizedAttempt && !ec.benchmarkComplete) pendingDebrief = ec.finalizedAttempt;
    }
  }

  if (contextReset) {
    saveTranscript();
    continue; // the fresh kickoff rides on the next step
  }
  pending = results;
  if (pendingDebrief) {
    // Queued behind the tool results: debrief + request for update_notebook.
    driver.pushUser(buildDebrief(pendingDebrief, runner.attemptsTotal));
  }
  saveTranscript(); // checkpoint after every turn

  if (runner.isFinished) break;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
console.log(
  `\n=== run complete (${elapsed}s) — peak live context ~${(peakContext / 1000).toFixed(1)}k tokens · ` +
    `billing: ${driver.totals.input} in [${driver.totals.cachedInput} cached] / ${driver.totals.output} out ===`,
);
for (const a of runner.attempts) {
  console.log(
    `attempt ${a.attempt}: height=${a.score.height.toFixed(3)}m peak=${a.score.peakHeight.toFixed(3)}m ` +
      `placements=${a.placements} (${a.endReason})  replay=${a.replayPath}`,
  );
}
if (runner.attempts.length > 0) {
  const heights = runner.attempts.map((a) => a.score.height);
  console.log(`best=${Math.max(...heights).toFixed(3)}m  mean=${(heights.reduce((x, y) => x + y, 0) / heights.length).toFixed(3)}m`);
} else {
  console.log('no attempts completed');
}
saveTranscript();
try {
  updateManifest();
} catch {
  // board manifest is best-effort
}
