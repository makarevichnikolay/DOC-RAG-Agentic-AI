// Provider selection — three INDEPENDENT switches, each with its own env var:
//
//   LLM_PROVIDER    openai | anthropic   who writes the answer (and does vision OCR)
//   EMBED_PROVIDER  openai | voyage | local  who turns text into vectors
//   VECTOR_STORE    memory | postgres    where those vectors live  (see lib/vector-store.ts)
//
// They are orthogonal on purpose: a vector store is not an embedding provider,
// and Anthropic has no embeddings API — so "use Claude" means Claude for the
// answer + Voyage / OpenAI / a local model for the vectors.
//
// Defaults reproduce the original behaviour exactly (openai + openai + memory),
// so an existing .env.local keeps working untouched.
//
// Nothing here throws at import time — keys are only demanded at query time,
// which is what keeps `npm run build` working without any API key.

import { BaseEmbedding, Settings } from "llamaindex";

export type LlmProvider = "openai" | "anthropic";
export type EmbedProvider = "openai" | "voyage" | "local";

function choose<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  varName: string
): T {
  // `||` not `??`: a key that is present but blank (EMBED_PROVIDER=) is common
  // in .env files and should mean "use the default", not fail validation.
  const value = (raw?.trim() || fallback).toLowerCase();
  if (!allowed.includes(value as T)) {
    throw new Error(
      `${varName}="${raw}" is not supported. Use one of: ${allowed.join(" | ")}.`
    );
  }
  return value as T;
}

export function llmProvider(): LlmProvider {
  return choose(process.env.LLM_PROVIDER, ["openai", "anthropic"] as const, "openai", "LLM_PROVIDER");
}

export function embedProvider(): EmbedProvider {
  return choose(
    process.env.EMBED_PROVIDER,
    ["openai", "voyage", "local"] as const,
    "openai",
    "EMBED_PROVIDER"
  );
}

export function llmModel(): string {
  return llmProvider() === "anthropic"
    ? process.env.ANTHROPIC_MODEL ?? "claude-opus-5"
    : process.env.LLM_MODEL ?? "gpt-4o-mini";
}

export function embedModelName(): string {
  switch (embedProvider()) {
    case "voyage":
      return process.env.VOYAGE_MODEL ?? "voyage-3.5";
    case "local":
      return process.env.LOCAL_EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";
    default:
      return process.env.EMBED_MODEL ?? "text-embedding-3-small";
  }
}

// Guardrail calibration is per embedding model: every model produces its own
// cosine-score distribution, so one constant cannot serve both providers. It is
// also per CHUNK SIZE — smaller chunks concentrate meaning and lift every score,
// so these were re-measured after clause-aware chunking landed.
//
// Read this before trusting the guardrail: on 12 golden and 4 off-topic
// questions the two populations OVERLAP, so no threshold separates them
// cleanly. "What is the personal phone number of Blue Harbor's CFO?" scores
// 0.546 because every contract carries a notices clause full of contact
// details — it really is semantically close to the documents. The score
// guardrail is a coarse first filter; the model's grounded refusal is what
// actually holds the line. Do not sell it as more than that.
//
// An explicit RELEVANCE_THRESHOLD always wins.
const THRESHOLD_BY_PROVIDER: Record<EmbedProvider, number> = {
  // Measured. Best operating point found: refuses 3 of 4 off-topic questions
  // (0.412, 0.406, 0.305) and wrongly refuses 0 of 12 goldens (lowest 0.448).
  // The old 0.32 was tuned against a single probe question and, under the
  // current chunking, would wrongly ALLOW 3 of the 4.
  local: 0.42,
  // NOT re-measured since clause-aware chunking changed the score distribution.
  // 0.28 was calibrated against the old 4,700-char chunks; expect it to be too
  // low now. Verify with the Inspector before relying on either.
  openai: 0.28,
  voyage: 0.28,
};

export function relevanceThreshold(): number {
  const fallback = THRESHOLD_BY_PROVIDER[embedProvider()];
  const raw = process.env.RELEVANCE_THRESHOLD?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  // NaN would make every `score < threshold` comparison false, silently turning
  // the refusal guardrail off — the one failure mode this app must not have.
  if (!Number.isFinite(parsed)) {
    console.warn(
      `[providers] RELEVANCE_THRESHOLD="${raw}" is not a number — using the ${embedProvider()} default ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

/** True when RELEVANCE_THRESHOLD was set to something unusable (for Settings). */
export function thresholdOverrideInvalid(): boolean {
  const raw = process.env.RELEVANCE_THRESHOLD?.trim();
  return Boolean(raw) && !Number.isFinite(Number(raw));
}

// Claude's reasoning depth. Opt-in only: `effort` exists on the Opus/Sonnet
// tiers but NOT on Haiku 4.5, which rejects it with
// "This model does not support the effort parameter." (400). Sending it by
// default would break every Haiku setup, so unset means "don't send it".
function anthropicEffort(): "low" | "medium" | "high" | "xhigh" | "max" | null {
  const raw = process.env.ANTHROPIC_EFFORT?.trim();
  if (!raw || raw.toLowerCase() === "none") return null;
  return choose(raw, ["low", "medium", "high", "xhigh", "max"] as const, "low", "ANTHROPIC_EFFORT");
}

/** True when a 400 is the API telling us this model has no `effort` parameter. */
function isEffortUnsupported(err: unknown): boolean {
  return (
    typeof (err as { status?: number })?.status === "number" &&
    (err as { status: number }).status === 400 &&
    /effort/i.test(String((err as { message?: string })?.message ?? ""))
  );
}

/**
 * Send the request, and if this model turns out not to support `effort`, drop it
 * and retry once. Keeps a wrong ANTHROPIC_EFFORT from being a hard failure.
 */
async function createMessage(
  client: import("@anthropic-ai/sdk").default,
  params: Record<string, unknown>
) {
  const effort = anthropicEffort();
  try {
    return await client.messages.create({
      ...(params as any),
      ...(effort ? { output_config: { effort } } : {}),
    });
  } catch (err) {
    if (!effort || !isEffortUnsupported(err)) throw err;
    console.warn(
      `[providers] ${params.model} does not support ANTHROPIC_EFFORT — retrying without it. ` +
        `Remove ANTHROPIC_EFFORT from your env to silence this.`
    );
    return client.messages.create(params as any);
  }
}

const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  voyage: "VOYAGE_API_KEY",
};

export function requireKey(provider: "openai" | "anthropic" | "voyage"): string {
  const envName = KEY_ENV[provider];
  const key = process.env[envName];
  if (!key) {
    throw new Error(
      `${envName} is not set, but the current configuration needs it. ` +
        `Copy .env.example to .env.local and add your key.`
    );
  }
  return key;
}

/** `local` needs no credentials — that is the point of it. */
export function hasKey(provider: LlmProvider | EmbedProvider): boolean {
  if (provider === "local") return true;
  return Boolean(process.env[KEY_ENV[provider]]);
}

/** The env var a provider needs, or null when it needs none. */
export function keyEnvName(provider: LlmProvider | EmbedProvider): string | null {
  return provider === "local" ? null : KEY_ENV[provider];
}

// ---- Embeddings ----
// Registered on LlamaIndex `Settings` so the in-memory index picks it up, and
// used directly by the Postgres store via Settings.embedModel.getTextEmbeddings().
// NOTE: Settings.llm is deliberately NOT set — this app never uses LlamaIndex to
// generate text (see generateAnswer below), only to embed and retrieve. Leaving
// it unset avoids dragging an OpenAI dependency into an Anthropic-only setup.

// Local embeddings via Transformers.js: the ONNX model runs in this process, so
// there is no API key and no network once the weights are cached. This is the
// on-prem story — paired with the Tesseract OCR engine, nothing but the final
// question and the retrieved excerpts ever leaves the machine.
//
// This is deliberately a hand-written BaseEmbedding rather than
// @llamaindex/huggingface: that package wraps the same four lines but also drags
// in @huggingface/inference, a cloud API client this path exists to avoid.
//
// @huggingface/transformers is an OPTIONAL peer dependency — it pulls in
// onnxruntime (~680 MB), which nobody should download unless they actually use
// this provider. `npm install` skips it; `npm run local:install` adds it.
const LOCAL_INSTALL_HINT =
  'EMBED_PROVIDER=local needs the optional package "@huggingface/transformers", ' +
  "which is not installed.\n" +
  "  Install it with:  npm run local:install\n" +
  "  (~680 MB — it is optional precisely because of that.)\n" +
  "  Or switch EMBED_PROVIDER to openai or voyage.";

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

// Held in a variable on purpose. With a string literal, TypeScript resolves the
// specifier at build time and `npm run build` fails with "Cannot find module"
// whenever the optional package is absent — which is the normal case. A variable
// specifier defers it to runtime, where the catch below handles it.
const TRANSFORMERS_PKG = "@huggingface/transformers";

class LocalEmbedding extends BaseEmbedding {
  private model: string;
  private extractor: Promise<any> | null = null;

  constructor(model: string) {
    super();
    this.model = model;
  }

  private pipe(): Promise<any> {
    // Loaded lazily: the first call downloads ~90 MB of weights and caches them
    // under node_modules/.cache, so later runs are offline and instant.
    if (!this.extractor) {
      this.extractor = import(/* webpackIgnore: true */ TRANSFORMERS_PKG)
        .catch((err) => {
          this.extractor = null; // let a later call retry after installing
          if (isModuleNotFound(err)) throw new Error(LOCAL_INSTALL_HINT);
          throw err;
        })
        .then(({ pipeline }: any) => pipeline("feature-extraction", this.model));
    }
    return this.extractor;
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const extractor = await this.pipe();
    // Mean pooling + L2 normalisation is what turns per-token vectors into one
    // sentence vector on the unit sphere, which is what cosine similarity needs.
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }
}

let embedSignature: string | null = null;

export async function configureEmbeddings(): Promise<void> {
  const signature = `${embedProvider()}:${embedModelName()}`;
  if (embedSignature === signature) return;

  if (embedProvider() === "local") {
    Settings.embedModel = new LocalEmbedding(embedModelName());
  } else if (embedProvider() === "voyage") {
    const { VoyageAIEmbedding } = await import("@llamaindex/voyage-ai");
    Settings.embedModel = new VoyageAIEmbedding({
      apiKey: requireKey("voyage"),
      model: embedModelName(),
      // Voyage supports asymmetric retrieval: questions and documents get
      // different instruction prefixes. Short question -> long clause is exactly
      // that shape, so turn it on.
      useInputTypes: "both",
    });
  } else {
    const { OpenAIEmbedding } = await import("@llamaindex/openai");
    Settings.embedModel = new OpenAIEmbedding({
      apiKey: requireKey("openai"),
      model: embedModelName(),
    });
  }

  embedSignature = signature;
}

/** Embed a batch of texts with whichever provider is configured. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  await configureEmbeddings();
  return Settings.embedModel.getTextEmbeddings(texts);
}

/** Embed a search query (Voyage prefixes it differently from a document). */
export async function embedQuery(query: string): Promise<number[]> {
  await configureEmbeddings();
  const vector = await Settings.embedModel.getQueryEmbedding({ type: "text", text: query });
  if (!vector) throw new Error("Embedding provider returned no vector for the query.");
  return vector;
}

// ---- Answer generation ----

/**
 * @param override  Run this one call on a different provider and/or model.
 *   The evals judge uses it: grading with the same model that wrote the answer
 *   is a known bias (models rate their own output generously), so
 *   EVAL_JUDGE_PROVIDER / EVAL_JUDGE_MODEL let you grade elsewhere without
 *   touching the app's answer model.
 *
 *   The PROVIDER has to be part of the override, not just the model. Overriding
 *   the model alone sent whatever id you named to whichever SDK LLM_PROVIDER
 *   selected — so with LLM_PROVIDER=anthropic, EVAL_JUDGE_MODEL=gpt-4o posted
 *   "gpt-4o" to the Anthropic API and every judged question failed. Escaping
 *   self-preference bias means changing vendor, which is exactly what that
 *   combination was trying to express.
 */
export async function generateAnswer(
  system: string,
  user: string,
  override?: { provider?: LlmProvider; model?: string }
): Promise<string> {
  const provider = override?.provider ?? llmProvider();
  const model = override?.model ?? (override?.provider ? defaultModelFor(override.provider) : llmModel());
  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: requireKey("anthropic") });
    // No temperature/top_p — current Claude models reject them with a 400.
    // Determinism comes from the prompt, which is strict already.
    const message = await createMessage(client, {
      model,
      max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? "2048"),
      system,
      messages: [{ role: "user", content: user }],
    });
    return message.content
      .filter((block): block is { type: "text"; text: string; citations: null } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: requireKey("openai") });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (completion.choices[0]?.message?.content ?? "").trim();
}

/** Per-provider default, used when a provider is named without a model. */
function defaultModelFor(provider: LlmProvider): string {
  return provider === "anthropic"
    ? process.env.ANTHROPIC_MODEL ?? "claude-opus-5"
    : process.env.LLM_MODEL ?? "gpt-4o-mini";
}

/**
 * Who grades the evals. Defaults to the answer provider and model, which is the
 * self-grading case the README warns about; set both vars to escape it.
 */
export function judgeTarget(): { provider: LlmProvider; model: string } {
  const rawProvider = process.env.EVAL_JUDGE_PROVIDER?.trim();
  const provider = rawProvider
    ? choose(rawProvider, ["openai", "anthropic"] as const, "openai", "EVAL_JUDGE_PROVIDER")
    : llmProvider();
  const model = process.env.EVAL_JUDGE_MODEL?.trim() || defaultModelFor(provider);
  return { provider, model };
}

// ---- Vision OCR ----
// Follows LLM_PROVIDER so that switching to Claude switches the whole pipeline,
// not just the answer step. Tesseract stays untouched (it has no provider).

const OCR_SYSTEM =
  "You are an OCR engine. Transcribe ALL text from the document image verbatim, " +
  "preserving structure (headings, clause numbers, line breaks). " +
  "Output plain text only — no commentary, no markdown fences.";

export async function transcribeImage(
  buffer: Buffer,
  mimeSub: string
): Promise<{ text: string; engine: string }> {
  const base64 = buffer.toString("base64");

  if (llmProvider() === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const model = process.env.ANTHROPIC_OCR_MODEL ?? llmModel();
    const client = new Anthropic({ apiKey: requireKey("anthropic") });
    const message = await createMessage(client, {
      model,
      // Its own budget: ANTHROPIC_MAX_TOKENS is for answer length, and tuning
      // that down would silently truncate a scanned page mid-transcription.
      max_tokens: Number(process.env.ANTHROPIC_OCR_MAX_TOKENS ?? "8192"),
      system: OCR_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: `image/${mimeSub}` as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: base64,
              },
            },
            { type: "text", text: "Transcribe this scanned contract page." },
          ],
        },
      ],
    });
    const text = message.content
      .filter((block): block is { type: "text"; text: string; citations: null } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return { text, engine: `Claude vision (${model})` };
  }

  const { default: OpenAI } = await import("openai");
  const model = process.env.OCR_MODEL ?? "gpt-4o-mini";
  const client = new OpenAI({ apiKey: requireKey("openai") });
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: OCR_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this scanned contract page." },
          { type: "image_url", image_url: { url: `data:image/${mimeSub};base64,${base64}` } },
        ],
      },
    ],
  });
  return {
    text: (response.choices[0]?.message?.content ?? "").trim(),
    engine: `OpenAI vision (${model})`,
  };
}
