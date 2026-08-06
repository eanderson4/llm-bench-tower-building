import { TOOL_DEFS } from '../sdk/tools';

/**
 * Provider drivers for the benchmark harness. Each driver owns its native
 * conversation state; the runner feeds tool results back uniformly, and
 * reset() discards the conversation (episodic mode: fresh context per attempt,
 * only the system prompt + a kickoff carrying the history table and notebook).
 *
 * Caching: conversations are append-only, so provider-side prompt caching
 * should hit on every turn after the first. OpenAI caches automatically
 * (reported via usage details); Anthropic needs explicit cache_control
 * breakpoints — we pin the system prompt and move a breakpoint to the tail of
 * the conversation each turn. cachedInput tokens are reported per turn.
 */

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResultMsg {
  id: string;
  name: string;
  result: unknown;
}

export interface Usage {
  input: number;
  output: number;
  cachedInput: number;
  /** Live context window size for this turn (input incl. cached), NOT cumulative billing. */
  contextTokens: number;
}

export interface AgentTurn {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface AgentDriver {
  step(results?: ToolResultMsg[]): Promise<AgentTurn>;
  pushUser(text: string): void;
  /** Discard the conversation and start fresh: system prompt + this kickoff only (episodic mode). */
  reset(kickoff: string): void;
  totals: Usage;
}

/** Harness-only tool (not part of the SDK): abandon the current attempt early. */
const NEXT_EPISODE_TOOL = {
  name: 'next_episode',
  description:
    'Abandon the current attempt and start the next one with a fresh inventory (same seed). The attempt is scored as it stands. Use when the tower is beyond saving.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

const PLACE_BLOCK_PARAMS = TOOL_DEFS.find((t) => t.function.name === 'place_block')!.function.parameters;

/** Harness-only tool: several placements in one call, to cut round trips. */
const PLACE_BLOCKS_TOOL = {
  name: 'place_blocks',
  description:
    'Place several blocks sequentially (max 6) in one call — same semantics as consecutive place_block calls. Faster, but you cannot adapt between batched placements: use for the confident middle of a run, single placements when things get dicey.',
  parameters: {
    type: 'object',
    properties: {
      placements: { type: 'array', maxItems: 6, items: PLACE_BLOCK_PARAMS },
    },
    required: ['placements'],
    additionalProperties: false,
  },
};

export const NOTES_LIMIT = 3000;

/** Harness-only tool: replace the persistent notebook carried across attempts (episodic mode). */
const UPDATE_NOTEBOOK_TOOL = {
  name: 'update_notebook',
  description: `Replace your persistent lab notebook (max ${NOTES_LIMIT} chars). In episodic mode this notebook — plus the harness history table — is the ONLY thing that survives the context reset into the next attempt. Write what a future you needs: strategies tried, observed noise behavior on this seed, focus/velocity allocations that worked or failed, and the plan for the next attempt. Full rewrite each time; keep it dense.`,
  parameters: {
    type: 'object',
    properties: { notes: { type: 'string', description: 'The complete new notebook contents.' } },
    required: ['notes'],
    additionalProperties: false,
  },
};

const ALL_TOOLS = [...TOOL_DEFS.map((t) => t.function), PLACE_BLOCKS_TOOL, NEXT_EPISODE_TOOL, UPDATE_NOTEBOOK_TOOL];

async function fetchJson(url: string, init: RequestInit, retries = 6): Promise<unknown> {
  // Slow reasoning models can legitimately think for >5 min on a turn; the
  // per-request timeout is overridable for them (BENCH_HTTP_TIMEOUT_MS).
  const timeoutMs = Number(process.env.BENCH_HTTP_TIMEOUT_MS ?? 300_000);
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // Network-level failures (header timeouts, resets, DNS) — retry like a 5xx.
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        continue;
      }
      throw err;
    }
    if (res.ok) return res.json();
    const body = await res.text();
    const retryable = [408, 409, 429, 500, 502, 503, 529].includes(res.status);
    if (retryable && i < retries) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 500)}`);
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { _parseError: raw.slice(0, 200) };
  }
}

// ---------------------------------------------------------------- OpenAI ----

/**
 * Default OpenAI driver: the /v1/responses API. Required for reasoning models
 * (gpt-5.6 rejects function tools on /v1/chat/completions). Conversation state
 * lives server-side via previous_response_id chaining (store=true default).
 */
export class OpenAIResponsesDriver implements AgentDriver {
  totals: Usage = { input: 0, output: 0, cachedInput: 0, contextTokens: 0 };
  private prevResponseId: string | null = null;
  private pendingUser: string[] = [];
  private readonly headers: Record<string, string>;
  private readonly tools = ALL_TOOLS.map((f) => ({ type: 'function', ...f }));

  constructor(
    private readonly model: string,
    private readonly system: string,
    kickoff: string,
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    this.pendingUser.push(kickoff);
  }

  pushUser(text: string): void {
    this.pendingUser.push(text);
  }

  reset(kickoff: string): void {
    this.prevResponseId = null; // start a fresh server-side chain
    this.pendingUser = [kickoff];
  }

  async step(results?: ToolResultMsg[]): Promise<AgentTurn> {
    let input: unknown[];
    if (results) {
      input = results.map((r) => ({
        type: 'function_call_output',
        call_id: r.id,
        output: JSON.stringify(r.result),
      }));
      // Queued user text rides after the tool outputs in the same input batch.
      if (this.pendingUser.length) input.push({ role: 'user', content: this.pendingUser.join('\n') });
    } else {
      input = this.pendingUser.map((text) => ({ role: 'user', content: text }));
    }
    this.pendingUser = [];

    const body = (await fetchJson('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        instructions: this.system,
        input,
        tools: this.tools,
        ...(this.prevResponseId ? { previous_response_id: this.prevResponseId } : {}),
      }),
    })) as {
      id: string;
      output: Array<
        | { type: 'message'; content: Array<{ type: string; text?: string }> }
        | { type: 'function_call'; call_id: string; name: string; arguments: string }
        | { type: string }
      >;
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    };

    this.prevResponseId = body.id;
    const usage: Usage = {
      input: body.usage?.input_tokens ?? 0,
      output: body.usage?.output_tokens ?? 0,
      cachedInput: body.usage?.input_tokens_details?.cached_tokens ?? 0,
      contextTokens: body.usage?.input_tokens ?? 0, // server-side chain: input is the full live context
    };
    this.totals.input += usage.input;
    this.totals.output += usage.output;
    this.totals.cachedInput += usage.cachedInput;
    this.totals.contextTokens = usage.contextTokens; // latest, not cumulative

    const text = body.output
      .filter((o): o is Extract<typeof o, { type: 'message' }> => o.type === 'message')
      .flatMap((o) => o.content)
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('\n');
    const toolCalls = body.output
      .filter((o): o is Extract<typeof o, { type: 'function_call' }> => o.type === 'function_call')
      .map((o) => ({ id: o.call_id, name: o.name, args: parseArgs(o.arguments) }));
    return { text, toolCalls, usage };
  }
}

interface OpenAIMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/** Chat-completions driver, kept for OpenAI-compatible third parties (--base-url). */
export class OpenAIChatDriver implements AgentDriver {
  totals: Usage = { input: 0, output: 0, cachedInput: 0, contextTokens: 0 };
  private messages: OpenAIMessage[] = [];
  private pendingUser: string[] = [];

  constructor(
    private readonly model: string,
    private readonly system: string,
    kickoff: string,
    private readonly baseUrl: string,
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) throw new Error(`no API key for ${baseUrl} — set the provider's env var (OPENAI_API_KEY / ZAI_API_KEY / DEEPSEEK_API_KEY / KIMI_API_KEY)`);
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    this.messages.push({ role: 'system', content: system });
    this.pendingUser.push(kickoff);
  }

  private readonly headers: Record<string, string>;

  pushUser(text: string): void {
    this.pendingUser.push(text);
  }

  reset(kickoff: string): void {
    this.messages = [{ role: 'system', content: this.system }];
    this.pendingUser = [kickoff];
  }

  async step(results?: ToolResultMsg[]): Promise<AgentTurn> {
    if (results) {
      for (const r of results) {
        this.messages.push({
          role: 'tool',
          tool_call_id: r.id,
          content: JSON.stringify(r.result),
        });
      }
    }
    // Queued user text goes after any tool results so tool calls never dangle.
    if (this.pendingUser.length) {
      this.messages.push({ role: 'user', content: this.pendingUser.join('\n') });
      this.pendingUser = [];
    }
    const body = (await fetchJson(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        messages: this.messages,
        tools: ALL_TOOLS.map((f) => ({ type: 'function', function: f })),
        // Escape hatch for reasoning models that occasionally generate without
        // terminating (observed: k3 hangs >15 min on some planning turns).
        ...(process.env.BENCH_MAX_TOKENS ? { max_tokens: Number(process.env.BENCH_MAX_TOKENS) } : {}),
      }),
    })) as {
      choices: Array<{ message: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };

    const message = body.choices[0].message;
    this.messages.push(message as OpenAIMessage);
    const usage: Usage = {
      input: body.usage?.prompt_tokens ?? 0,
      output: body.usage?.completion_tokens ?? 0,
      cachedInput: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      contextTokens: body.usage?.prompt_tokens ?? 0, // prompt_tokens is the full live context
    };
    this.totals.input += usage.input;
    this.totals.output += usage.output;
    this.totals.cachedInput += usage.cachedInput;
    this.totals.contextTokens = usage.contextTokens; // latest, not cumulative
    return {
      text: message.content ?? '',
      toolCalls: (message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: parseArgs(tc.function.arguments),
      })),
      usage,
    };
  }
}

// ------------------------------------------------------------- Anthropic ----

type Block = Record<string, unknown> & { type: string; cache_control?: { type: 'ephemeral' } };

export class AnthropicDriver implements AgentDriver {
  totals: Usage = { input: 0, output: 0, cachedInput: 0, contextTokens: 0 };
  private messages: Array<{ role: string; content: Block[] }> = [];
  private pendingUser: string[] = [];
  private readonly systemBlocks: Block[];
  private readonly headers: Record<string, string>;
  private readonly tools = ALL_TOOLS.map((f) => ({
    name: f.name,
    description: f.description,
    input_schema: f.parameters,
  }));

  constructor(
    private readonly model: string,
    system: string,
    kickoff: string,
    apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY_PERSONAL,
  ) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY (or _PERSONAL) is not set');
    this.headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
    // System prompt is a stable, sizeable prefix — cache it.
    this.systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    this.pendingUser.push(kickoff);
  }

  pushUser(text: string): void {
    this.pendingUser.push(text);
  }

  reset(kickoff: string): void {
    this.messages = [];
    this.pendingUser = [kickoff];
  }

  /** Move the cache breakpoint to the tail of the conversation. */
  private markBreakpoint(): void {
    for (const m of this.messages) {
      for (const b of m.content) delete b.cache_control;
    }
    const last = this.messages[this.messages.length - 1];
    if (last && last.content.length > 0) {
      last.content[last.content.length - 1]!.cache_control = { type: 'ephemeral' };
    }
  }

  async step(results?: ToolResultMsg[]): Promise<AgentTurn> {
    if (results) {
      const content: Block[] = results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: JSON.stringify(r.result),
      }));
      // Queued user text rides in the same user turn, after the tool results.
      if (this.pendingUser.length) content.push({ type: 'text', text: this.pendingUser.join('\n') });
      this.messages.push({ role: 'user', content });
    } else if (this.pendingUser.length) {
      this.messages.push({ role: 'user', content: this.pendingUser.map((text) => ({ type: 'text', text })) });
    }
    this.pendingUser = [];
    this.markBreakpoint();
    const body = (await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        system: this.systemBlocks,
        tools: this.tools,
        messages: this.messages,
      }),
    })) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };

    // Push assistant content verbatim (thinking blocks must round-trip intact).
    this.messages.push({ role: 'assistant', content: body.content as Block[] });
    const usage: Usage = {
      input: body.usage?.input_tokens ?? 0,
      output: body.usage?.output_tokens ?? 0,
      cachedInput: body.usage?.cache_read_input_tokens ?? 0,
      // Anthropic bills cached and uncached prompt parts separately; the live
      // context is the sum of all three.
      contextTokens:
        (body.usage?.input_tokens ?? 0) +
        (body.usage?.cache_read_input_tokens ?? 0) +
        (body.usage?.cache_creation_input_tokens ?? 0),
    };
    this.totals.input += usage.input;
    this.totals.output += usage.output;
    this.totals.cachedInput += usage.cachedInput;
    this.totals.contextTokens = usage.contextTokens; // latest, not cumulative
    return {
      text: body.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'),
      toolCalls: body.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id!, name: b.name!, args: b.input })),
      usage,
    };
  }
}

// ---------------------------------------------------------------- router ----

export function makeDriver(model: string, system: string, kickoff: string, opts: { baseUrl?: string } = {}): AgentDriver {
  if (model.startsWith('claude')) return new AnthropicDriver(model, system, kickoff);
  if (opts.baseUrl) return new OpenAIChatDriver(model, system, kickoff, opts.baseUrl);
  if (model.startsWith('glm')) {
    return new OpenAIChatDriver(model, system, kickoff, 'https://api.z.ai/api/coding/paas/v4', process.env.ZAI_API_KEY);
  }
  if (model.startsWith('deepseek')) {
    return new OpenAIChatDriver(model, system, kickoff, 'https://api.deepseek.com', process.env.DEEPSEEK_API_KEY);
  }
  if (model.startsWith('kimi') || model === 'k3') {
    return new OpenAIChatDriver(model, system, kickoff, 'https://api.kimi.com/coding/v1', process.env.KIMI_API_KEY);
  }
  return new OpenAIResponsesDriver(model, system, kickoff);
}
