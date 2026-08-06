/**
 * Probe: reproduce the k3 turn-2 hang outside the full bench loop.
 * Plays the exact system prompt + kickoff for a challenge, feeds the real
 * get_inventory result back, and times each step. Usage:
 *   npx tsx scripts/k3-probe.ts [challengeId] [step2Variant]
 * step2Variant: full (default) = real inventory result; trivial = "ok" string;
 *               notools = step 1 without tool definitions is NOT possible via
 *               the driver, so this only trims the result payload.
 */
import { buildSystemPrompt, KICKOFF } from '../src/harness/prompt';
import { makeDriver } from '../src/harness/providers';
import { EpisodeClient } from '../src/sdk/client';

const challengeId = process.argv[2] ?? 'mixed';
const variant = process.argv[3] ?? 'full';

const client = await EpisodeClient.create(challengeId, 11);
const driver = makeDriver('k3', buildSystemPrompt(challengeId, 2, 11, 'episodic'), KICKOFF);

console.time('step1');
const t1 = await driver.step();
console.timeEnd('step1');
console.log('step1 calls:', t1.toolCalls.map((c) => c.name).join(',') || '(none)');

const inv = client.callTool('get_inventory', undefined);
const payload = variant === 'trivial' ? 'ok' : inv;
const callId = t1.toolCalls[0]?.id ?? 'call_0';
console.time('step2');
const t2 = await driver.step([{ id: callId, name: 'get_inventory', result: payload }]);
console.timeEnd('step2');
console.log('step2 text:', t2.text.slice(0, 120));
console.log('step2 calls:', t2.toolCalls.map((c) => c.name).join(',') || '(none)');
