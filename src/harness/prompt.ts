import { getChallenge } from '../core/challenges';
import { SDK_DOC } from '../sdk/tools';
import type { AttemptSummary, HarnessMode } from './attempts';
import { NOTES_LIMIT } from './providers';

/** System prompt: the SDK doc plus the concrete challenge card and task rules. */
export function buildSystemPrompt(challengeId: string, attemptsTotal: number, seed: number, mode: HarnessMode = 'session'): string {
  const c = getChallenge(challengeId);
  const K = c.noise.sigmaX0 * c.noise.sigmaV0;
  const episodic = `
## Context discipline (episodic mode)
After each attempt your conversation is RESET. The next attempt starts with a
fresh context containing only this prompt, the harness-kept attempt history,
and your notebook. When an attempt ends, call update_notebook with your FULL
revised notebook (max ${NOTES_LIMIT} chars) — strategies tried, what the noise
actually did on this seed, focus/velocity allocations that worked or failed,
and your plan for the next attempt. Anything you don't write down is lost.
`;
  return `${SDK_DOC}

## This run
- Challenge: ${c.name} (${c.id}) — ${c.description}
- Noise: sigmaX0=${c.noise.sigmaX0} m, sigmaV0=${c.noise.sigmaV0} m/s, so K=${K.toPrecision(3)} (m·m/s).
- maxSpeed=${c.maxSpeed} m/s. Ground is ${c.groundSize}x${c.groundSize} m. Gravity=${c.gravity}.
- Inventory: ${c.inventory.length} blocks (same set every attempt).

## Task
You will play ${attemptsTotal} attempts, all on seed ${seed}. Use what you learn
from each attempt — actual sampled positions/velocities, topples, and final
heights — to improve your strategy on the next. Try to beat your best height
every attempt.

Rules of engagement:
- Start each attempt with get_inventory; use observe whenever you need state.
- One placement per place_block call. Placement results include the ACTUAL
  sampled values and the post-settle tower stats — read them.
- When an attempt's inventory is exhausted, the next attempt starts
  automatically. Use next_episode only to abandon a doomed attempt early.
- Validation errors are free; adapt and retry. Physics mistakes are forever.
- Be deliberate but efficient: plan your structure and focus allocation, then
  execute. Batch confident placements with place_blocks; use observe sparingly
  (place_block results already report tower stats).
${mode === 'episodic' ? episodic : ''}`;
}

export const KICKOFF = 'Begin. Play the benchmark now — start attempt 1 by calling get_inventory.';

/** Harness-computed per-attempt record — trustworthy ground truth, unlike the notebook. */
export function buildHistoryTable(attempts: AttemptSummary[]): string {
  if (attempts.length === 0) return '(no attempts completed yet)';
  const rows = attempts.map(
    (a) =>
      `| ${a.attempt} | ${a.seed} | ${a.score.height.toFixed(3)} | ${a.score.peakHeight.toFixed(3)} | ${a.placements} | ${a.endReason} |`,
  );
  return ['| attempt | seed | height (m) | peak (m) | placements | end |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

/** First user message of a fresh conversation for attempt N>1 (episodic mode). */
export function buildKickoff(attempts: AttemptSummary[], notebook: string, attemptsTotal: number): string {
  const next = attempts.length + 1;
  return `Notebook saved. Context reset complete — you are starting attempt ${next}/${attemptsTotal} with a fresh conversation.

## Attempt history (harness record)
${buildHistoryTable(attempts)}

## Your notebook (written by you after attempt ${attempts.length})
${notebook || '(empty)'}

Begin attempt ${next}: call get_inventory, then execute your plan.`;
}

/** Debrief nudge sent right after an attempt ends, before the context reset. */
export function buildDebrief(summary: AttemptSummary, attemptsTotal: number): string {
  const s = summary.score;
  return [
    `Attempt ${summary.attempt}/${attemptsTotal} is over: height ${s.height.toFixed(3)}m, peak ${s.peakHeight.toFixed(3)}m, ${summary.placements} placements (${summary.endReason}).`,
    `Your conversation is about to be reset for attempt ${summary.attempt + 1}. Before the reset, call update_notebook with your full revised notebook (max ${NOTES_LIMIT} chars): what you tried, what the noise actually did on this seed, what worked or failed, and your plan for the next attempt. The placement results above are your last chance to extract calibration data — after the reset, only your notebook and the history table survive.`,
  ].join('\n');
}
