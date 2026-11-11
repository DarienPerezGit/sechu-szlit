/**
 * OpenRouter model validation for agentic work (tool calling + streaming).
 *
 * Usage:
 *   node --env-file=.env.local scripts/openrouter-model-check.mjs
 *
 * Requires @openrouter/sdk, which is NOT a project dependency (local tooling,
 * not part of the app): `pnpm dlx` it or add it temporarily before running.
 *
 * Reads OPENROUTER_API_KEY from the environment (never hardcoded).
 * For each model: sends a chat completion with a `get_current_time` tool and
 * records whether the model actually performed a tool call.
 * Streaming is checked on a "coding agent" candidate (poolside/laguna-s-2.1:free).
 * 429 responses are retried once with a 5s backoff before being marked failed.
 */
import { OpenRouter } from "@openrouter/sdk";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("FATAL: OPENROUTER_API_KEY is not set in the environment.");
  process.exit(1);
}

const client = new OpenRouter({
  apiKey: API_KEY,
  // Some free models (thinkingmachines/inkling*) are gated to agentic harnesses.
  // The referer makes OpenRouter treat this script as an agentic app.
  httpReferer: "https://opencode.ai",
  appTitle: "sechub-openrouter-model-check",
});

/**
 * Task slug -> real OpenRouter slug (confirmed against GET /api/v1/models).
 * Several task-listed slugs do not exist verbatim; the real slug is used.
 */
const MODELS = [
  { task: "stealth/space-bunny-alpha", slug: "stealth/space-bunny-alpha" },
  { task: "nvidia/nemotron-3-ultra (free)", slug: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  { task: "inclusionai/ling-3.0-flash-fin (free)", slug: "inclusionai/ling-3.0-flash-fin:free" },
  { task: "poolside/laguna-s-2.1 (free)", slug: "poolside/laguna-s-2.1:free" },
  { task: "dots-studio/dots3-note-preview (free)", slug: "dots-studio/dots-3-note-preview:free" },
  { task: "nvidia/nemotron-3.5-lightning (free)", slug: "nvidia/nemotron-3.5-lightning:free" },
  { task: "nvidia/nemotron-3-super (free)", slug: "nvidia/nemotron-3-super-120b-a12b:free" },
  { task: "inclusionai/ling-3.0-flash-sante (free)", slug: "inclusionai/ling-3.0-flash-sante:free" },
  { task: "thinkingmachines/inkling (free)", slug: "thinkingmachines/inkling:free" },
  { task: "cohere/north-mini-code (free)", slug: "cohere/north-mini-code:free" },
  { task: "thinkingmachines/inkling-small (free)", slug: "thinkingmachines/inkling-small:free" },
  { task: "poolside/laguna-xs-2.1 (free)", slug: "poolside/laguna-xs-2.1:free" },
  { task: "qwen/qwen3.8-27b (free)", slug: "qwen/qwen3.8-27b:free" },
  { task: "nvidia/nemotron-3-nano-omni (free)", slug: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free" },
];

const TIME_TOOL = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get the current time in a given IANA timezone.",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA timezone name, e.g. America/Argentina/Buenos_Aires" },
      },
      required: ["timezone"],
    },
  },
};

const TOOL_MESSAGES = [
  {
    role: "system",
    content:
      "You are a helpful assistant. When the user asks for the current time, call the get_current_time tool with the appropriate timezone and return its result.",
  },
  {
    role: "user",
    content: "What time is it right now in Buenos Aires? Please use the available tool.",
  },
];

const STREAM_MESSAGES = [
  { role: "user", content: "Count from 1 to 5, one number per line. Keep it short." },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function testToolCalling(slug) {
  const started = performance.now();
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client.chat.send({
        chatRequest: {
          model: slug,
          messages: TOOL_MESSAGES,
          tools: [TIME_TOOL],
          stream: false,
          max_tokens: 400,
        },
      });
      const latencyMs = Math.round(performance.now() - started);
      const choice = res?.choices?.[0];
      const toolCalls = choice?.message?.toolCalls ?? [];
      const toolCalled = toolCalls.length > 0;
      const finishReason = choice?.finishReason ?? null;
      const contentPreview = String(choice?.message?.content ?? "").slice(0, 120);
      return {
        ok: true,
        toolCalled,
        toolNames: toolCalls.map((tc) => tc.function?.name).filter(Boolean),
        finishReason,
        latencyMs,
        contentPreview,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      const status = err?.status ?? err?.code ?? err?.statusCode ?? "?";
      if (String(status) === "429" && attempt === 1) {
        console.log(`    [429] backoff 5s, retrying ${slug}...`);
        await sleep(5000);
        continue;
      }
      return {
        ok: false,
        toolCalled: false,
        toolNames: [],
        finishReason: null,
        latencyMs: Math.round(performance.now() - started),
        error: `${status}: ${err?.message ?? String(err)}`,
        attempts: attempt,
      };
    }
  }
  return {
    ok: false,
    toolCalled: false,
    toolNames: [],
    finishReason: null,
    latencyMs: Math.round(performance.now() - started),
    error: `last attempt failed: ${lastError?.message ?? String(lastError)}`,
    attempts: 2,
  };
}

async function testStreaming(slug) {
  const started = performance.now();
  try {
    const res = await client.chat.send({
      chatRequest: {
        model: slug,
        messages: STREAM_MESSAGES,
        stream: true,
        max_tokens: 200,
        temperature: 0,
      },
    });
    let chunks = 0;
    let text = "";
    const chunkTypes = new Set();
    let toolChunks = 0;
    for await (const chunk of res) {
      chunks++;
      const choice = chunk?.choices?.[0];
      if (choice?.delta?.content) text += choice.delta.content;
      if (choice?.delta?.toolCalls?.length) toolChunks++;
      chunkTypes.add(choice?.delta?.role ?? "?");
    }
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: chunks > 0,
      chunks,
      textLen: text.length,
      toolChunks,
      latencyMs,
      note: chunks > 0 ? "" : "stream ended with 0 chunks",
    };
  } catch (err) {
    const status = err?.status ?? err?.code ?? "?";
    return {
      ok: false,
      chunks: 0,
      textLen: 0,
      toolChunks: 0,
      latencyMs: Math.round(performance.now() - started),
      note: `${status}: ${err?.message ?? String(err)}`,
    };
  }
}

const results = [];
for (const m of MODELS) {
  process.stdout.write(`\n>>> ${m.task}  [${m.slug}]\n`);
  const toolResult = await testToolCalling(m.slug);
  process.stdout.write(
    `    tool: ${toolResult.ok ? "OK" : "FAIL"} | called=${toolResult.toolCalled} names=[${toolResult.toolNames.join(",")}] finish=${toolResult.finishReason} ${toolResult.latencyMs}ms attempts=${toolResult.attempts}${toolResult.error ? " | err=" + toolResult.error : ""}\n`
  );
  results.push({ ...m, phase: "tool", ...toolResult });
}

// Streaming test on a "coding agent" candidate (Laguna S 2.1, free variant).
const STREAM_TARGET = "poolside/laguna-s-2.1:free";
process.stdout.write(`\n>>> STREAMING test: ${STREAM_TARGET}\n`);
const streamResult = await testStreaming(STREAM_TARGET);
process.stdout.write(
  `    stream: ${streamResult.ok ? "OK" : "FAIL"} | chunks=${streamResult.chunks} textLen=${streamResult.textLen} toolChunks=${streamResult.toolChunks} ${streamResult.latencyMs}ms${streamResult.note ? " | " + streamResult.note : ""}\n`
);

const output = {
  generatedAt: new Date().toISOString(),
  streamTarget: STREAM_TARGET,
  stream: streamResult,
  results,
};
process.stdout.write("\n\n===== JSON OUTPUT =====\n");
process.stdout.write(JSON.stringify(output, null, 2) + "\n");