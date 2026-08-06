import { getChallenge } from '../core/challenges';
import { Episode } from '../core/episode';
import type {
  ChallengeDef,
  InventoryItem,
  Observation,
  PlaceResult,
  ReplayFile,
  Score,
} from '../core/types';
import { previewSigmas } from './utils';

/**
 * Typed SDK surface over an Episode. This is what the LLM harness (and the
 * scripted agents) drive; raw tool-call JSON goes through callTool, which
 * relies on Episode's validation for retryable, self-correction-friendly errors.
 */
export class EpisodeClient {
  private constructor(
    private readonly ep: Episode,
    readonly challenge: ChallengeDef,
  ) {}

  static async create(challengeId: string, seed: number): Promise<EpisodeClient> {
    const challenge = getChallenge(challengeId);
    const ep = await Episode.create(challenge, seed);
    return new EpisodeClient(ep, challenge);
  }

  getInventory(): InventoryItem[] {
    return this.ep.inventory();
  }

  observe(): Observation {
    return this.ep.observe();
  }

  /** Accepts untrusted input; validation errors come back as { ok: false, error }. */
  placeBlock(req: unknown): PlaceResult {
    return this.ep.place(req as Parameters<Episode['place']>[0]);
  }

  score(): Score {
    return this.ep.score();
  }

  replay(): ReplayFile {
    return this.ep.replay();
  }

  /** What sigmaX/sigmaV does a focus value buy in this challenge? */
  previewSigmas(focus: number): { sigmaX: number; sigmaV: number } {
    return previewSigmas(focus, this.challenge.noise);
  }

  /** Dispatch entry point for tool-calling harnesses. */
  callTool(name: string, args: unknown): unknown {
    switch (name) {
      case 'get_inventory':
        return this.getInventory();
      case 'observe':
        return this.observe();
      case 'place_block':
        return this.placeBlock(args);
      default:
        return { ok: false, error: `Unknown tool "${name}". Available: get_inventory, observe, place_block.` };
    }
  }
}
