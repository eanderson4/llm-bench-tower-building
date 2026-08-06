import { describe, expect, it } from 'vitest';
import type { AttemptSummary } from '../src/harness/attempts';
import { buildDebrief, buildHistoryTable, buildKickoff, buildSystemPrompt } from '../src/harness/prompt';

function summary(attempt: number, height: number, peak: number): AttemptSummary {
  return {
    attempt,
    seed: 11,
    score: { height, peakHeight: peak, blocksUsed: 20 },
    placements: 20,
    replayPath: `replays/x-a${attempt}.json`,
    endReason: 'completed',
  };
}

describe('buildSystemPrompt', () => {
  it('documents update_notebook only in episodic mode', () => {
    expect(buildSystemPrompt('bricks', 2, 11, 'episodic')).toContain('update_notebook');
    expect(buildSystemPrompt('bricks', 2, 11, 'session')).not.toContain('update_notebook');
  });
});

describe('buildHistoryTable', () => {
  it('handles the empty history', () => {
    expect(buildHistoryTable([])).toContain('no attempts');
  });
  it('lists attempts with heights and peaks', () => {
    const t = buildHistoryTable([summary(1, 1.234, 1.987), summary(2, 2.345, 2.4)]);
    expect(t).toContain('| 1 | 11 | 1.234 | 1.987 | 20 | completed |');
    expect(t).toContain('| 2 | 11 | 2.345 | 2.400 | 20 | completed |');
  });
});

describe('buildKickoff', () => {
  it('carries history and notebook into the next attempt', () => {
    const k = buildKickoff([summary(1, 1.234, 1.987)], 'focus 0.7 drifts +x', 3);
    expect(k).toContain('attempt 2/3');
    expect(k).toContain('1.234');
    expect(k).toContain('focus 0.7 drifts +x');
  });
});

describe('buildDebrief', () => {
  it('reports the outcome and asks for update_notebook', () => {
    const d = buildDebrief(summary(1, 1.234, 1.987), 3);
    expect(d).toContain('1.234');
    expect(d).toContain('update_notebook');
    expect(d).toContain('attempt 2');
  });
});
