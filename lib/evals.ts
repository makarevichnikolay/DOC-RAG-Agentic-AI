// Executable evaluation of the RAG pipeline against the golden question sets.
//
// This replaces a page that printed the word "pass" 14 times regardless of
// whether anything worked. Every number produced here comes from running the
// real pipeline — same retrieval, same guardrail, same model — over
// data/<client>/seed.json `goldens`.
//
// Design follows the standard guidance for LLM evaluation:
//
//   • Deterministic first. Anything a substring comparison can decide is
//     decided that way: it is free, instant and perfectly reproducible. The
//     judge is reserved for the one question that genuinely needs reading
//     comprehension — "is this answer right?"
//   • Discrete grades, not scores. Judges are unreliable at "rate this 1-10"
//     and reliable at "pick one of three labels", so correctness is
//     correct/partial/incorrect and faithfulness is a boolean.
//   • Reasoning before verdict. The judge writes its reasoning first; asking
//     for the label first and the justification second gets post-hoc rationales.
//   • Correctness and faithfulness are graded SEPARATELY. An answer can match
//     the expected facts while asserting something the excerpts never said
//     (a lucky hallucination), and that has to be visible, not averaged away.
//   • Every run records the configuration it ran under. A pass rate is
//     meaningless without the provider, model, threshold and chunk cap that
//     produced it.
//
// Known bias, stated rather than hidden: by default the judge is the same model
// that produced the answer, and models favour their own output. Set
// EVAL_JUDGE_MODEL to grade with a different one.

import fs from "node:fs";
import path from "node:path";
import { CHUNKER_VERSION, maxChunkChars } from "./chunking";
import { getClientConfig, type ClientConfig } from "./clients";
import {
  embedModelName,
  embedProvider,
  generateAnswer,
  judgeTarget,
  llmModel,
  llmProvider,
  relevanceThreshold,
} from "./providers";
import { getUploadedDoc, runQuery, TOP_K } from "./rag";
import { getSeed } from "./seeds";
import { vectorStoreKind } from "./vector-store";
import type { Golden } from "./types";

export type Correctness = "correct" | "partial" | "incorrect";

export type GoldenResult = {
  q: string;
  expected: string;
  source: string;
  /** The off-topic probe: the pipeline is supposed to REFUSE this one. */
  isProbe: boolean;

  // --- what the pipeline actually did ---
  answer: string;
  refused: boolean;
  topScore: number;
  citedFiles: string[];
  contextChars: number;
  ms: number;

  // --- deterministic checks (no LLM involved) ---
  /** Probe refused / real question answered. */
  refusalCorrect: boolean;
  /**
   * Every returned snippet is findable in the document it claims to come from.
   * This is exactly what the source viewer does, so a failure here means a
   * citation that silently highlights nothing.
   */
  citationsValid: boolean;
  /** Every document named in the golden's `source` was actually cited. */
  correctDocsCited: boolean | null;

  // --- judged (one LLM call, skipped for probes and when judging is off) ---
  correctness: Correctness | null;
  faithful: boolean | null;
  judgeNote: string | null;

  pass: boolean;
  error?: string;
};

export type EvalRun = {
  clientId: string;
  clientName: string;
  finishedAt: string;
  durationMs: number;
  judged: boolean;
  config: Record<string, string | number>;
  results: GoldenResult[];
  summary: {
    total: number;
    passed: number;
    passRate: number;
    refusalAccuracy: number;
    citationValidity: number;
    correctDocRate: number | null;
    correctness: Record<Correctness, number>;
    /**
     * Judging was requested but produced no verdict (API error, unparseable
     * output). Such a question still passes on its deterministic checks, so
     * without this number a judge outage would quietly inflate the pass rate.
     */
    ungraded: number;
    faithfulness: number | null;
    /** Answers asserting something the excerpts do not support. */
    hallucinationRate: number | null;
    avgTopScore: number;
    avgContextChars: number;
    avgMs: number;
  };
};

/**
 * Requests in flight at once. Enough to be quick, low enough to avoid 429s.
 *
 * Validated rather than trusted, because the failure is silent and severe: the
 * worker pool below is sized from this, `Math.min(0, n)` spawns NO workers,
 * `Promise.all([])` resolves at once, and `mapLimit` returns a fully SPARSE
 * array. `filter` and `reduce` skip holes instead of throwing, so runEvals
 * would report "0 of 9 passed, 0%" with no error anywhere — a fabricated
 * measurement, on the one feature that exists to stop fabricating them.
 *
 * `EVAL_CONCURRENCY=` (blank, easy to leave behind after copying .env.example)
 * is the realistic trigger: Number("") === 0, which is finite and >= 0, so a
 * naive guard passes it through.
 */
function evalConcurrency(): number {
  const raw = process.env.EVAL_CONCURRENCY?.trim();
  if (!raw) return 3;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(
      `[evals] EVAL_CONCURRENCY="${raw}" is not a usable number — using 3.`
    );
    return 3;
  }
  return parsed;
}

const isProbe = (g: Golden) => /guardrail|probe|^n\/a/i.test(g.source);

// ---- Deterministic helpers ----

function flatten(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whitespace-insensitive containment — the same tolerance the viewer applies. */
function containsFlat(haystack: string, needle: string): boolean {
  const n = flatten(needle);
  return n.length > 0 && flatten(haystack).includes(n);
}

/** "Doc 1; Doc 2, Art. 9" → the file names of documents 1 and 2 for this client. */
function expectedFiles(clientId: string, source: string): string[] {
  const docs = getSeed(clientId).documents;
  return [...source.matchAll(/Doc\s+(\d+)/gi)]
    .map((m) => docs[Number(m[1]) - 1]?.file)
    .filter((f): f is string => Boolean(f));
}

async function documentText(cfg: ClientConfig, fileName: string): Promise<string | null> {
  for (const dir of [cfg.contractsDir, cfg.extraDir]) {
    const full = path.join(dir, fileName);
    if (fs.existsSync(full)) return fs.readFileSync(full, "utf-8");
  }
  // Uploaded documents live in the store, not on disk.
  return (await getUploadedDoc(cfg.id, fileName))?.text ?? null;
}

// ---- The judge ----

const JUDGE_SYSTEM = `You are grading a contract-analysis assistant. You are a strict, literal grader.

You will be given a QUESTION, the EXPECTED facts a correct answer must state (written by a lawyer), the EXCERPTS the assistant was given, and the assistant's ANSWER.

Grade two things INDEPENDENTLY.

1. correctness — does ANSWER state the facts in EXPECTED?
   "correct"   — every fact in EXPECTED appears in ANSWER with the same values
   "partial"   — some facts appear, others are missing, vague, or hedged
   "incorrect" — ANSWER contradicts EXPECTED, or states none of it
   Wording, formatting, ordering and EXTRA detail do not matter. Values do.
   "10 years" and "ten (10) years" are the same fact. "10 years" and "5 years" are not.

2. faithful — is every factual claim in ANSWER supported by EXCERPTS?
   true  — every claim traces back to the excerpts
   false — ANSWER asserts something the excerpts do not say, even if it happens
           to be true in the real world. That is a hallucination.

These are independent: an answer can be correct but unfaithful, or faithful but
incomplete. Do not let one grade influence the other.

Write your reasoning FIRST, then the grades.
Reply with ONLY a JSON object, no prose around it, no code fences:
{"reasoning": "<one or two sentences>", "correctness": "correct|partial|incorrect", "faithful": true|false}`;

type Judgement = { correctness: Correctness; faithful: boolean; reasoning: string };

function parseJudgement(raw: string): Judgement | null {
  // Tolerate a model that wraps JSON in prose or fences despite instructions.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Judgement>;
    const c = parsed.correctness;
    if (c !== "correct" && c !== "partial" && c !== "incorrect") return null;
    return {
      correctness: c,
      faithful: parsed.faithful === true,
      reasoning: String(parsed.reasoning ?? "").slice(0, 400),
    };
  } catch {
    return null;
  }
}

async function judge(
  question: string,
  expected: string,
  context: string[],
  answer: string
): Promise<Judgement | null> {
  const excerpts = context.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  const raw = await generateAnswer(
    JUDGE_SYSTEM,
    `QUESTION:\n${question}\n\nEXPECTED:\n${expected}\n\nEXCERPTS:\n${excerpts}\n\nANSWER:\n${answer}`,
    judgeTarget()
  );
  return parseJudgement(raw);
}

// ---- Running one golden ----

async function evaluate(
  cfg: ClientConfig,
  g: Golden,
  withJudge: boolean
): Promise<GoldenResult> {
  const started = Date.now();
  const probe = isProbe(g);
  const base: GoldenResult = {
    q: g.q,
    expected: g.expected,
    source: g.source,
    isProbe: probe,
    answer: "",
    refused: false,
    topScore: 0,
    citedFiles: [],
    contextChars: 0,
    ms: 0,
    refusalCorrect: false,
    citationsValid: true,
    correctDocsCited: null,
    correctness: null,
    faithful: null,
    judgeNote: null,
    pass: false,
  };

  try {
    const { result, context } = await runQuery(cfg.id, g.q);
    base.answer = result.answer;
    base.refused = result.refused;
    base.topScore = result.topScore;
    base.citedFiles = [...new Set(result.sources.map((s) => s.fileName))];
    base.contextChars = context.reduce((n, c) => n + c.length, 0);

    // 1) Refusal behaviour — the probe must be refused, the rest must not be.
    base.refusalCorrect = probe ? result.refused : !result.refused;

    // 2) Citation validity — can the viewer actually find each cited snippet?
    for (const s of result.sources) {
      const text = await documentText(cfg, s.fileName);
      if (!text || !containsFlat(text, s.snippet.slice(0, 120))) {
        base.citationsValid = false;
        break;
      }
    }

    // 3) Did we cite the documents the golden says hold the answer?
    if (!probe) {
      const want = expectedFiles(cfg.id, g.source);
      base.correctDocsCited = want.length
        ? want.every((f) => base.citedFiles.includes(f))
        : null;
    }

    // 4) The judge — only where reading comprehension is actually required.
    //    A refused probe has no answer worth grading.
    if (withJudge && !probe && !result.refused) {
      // Scoped try: the judge is an extra opinion ON a result we already have.
      // A 429 (likely — concurrency x two LLM calls per question), a timeout or
      // a bad EVAL_JUDGE_MODEL must not throw away a question whose retrieval,
      // answer, refusal check and citations all succeeded. Degrade to
      // "ungraded", exactly as an unparseable verdict already does.
      try {
        const verdict = await judge(g.q, g.expected, context, result.answer);
        if (verdict) {
          base.correctness = verdict.correctness;
          base.faithful = verdict.faithful;
          base.judgeNote = verdict.reasoning;
        } else {
          base.judgeNote = "judge returned unparseable output";
        }
      } catch (err: unknown) {
        base.judgeNote = `judge call failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    // A probe passes on refusal alone. A real question must be answered, cite
    // findable sources, and — when judged — be both correct and faithful.
    base.pass = probe
      ? base.refusalCorrect
      : base.refusalCorrect &&
        base.citationsValid &&
        (base.correctness === null || base.correctness === "correct") &&
        (base.faithful === null || base.faithful);
  } catch (err: unknown) {
    base.error = err instanceof Error ? err.message : "query failed";
    base.pass = false;
  }

  base.ms = Date.now() - started;
  return base;
}

/**
 * Bounded-concurrency map that preserves input order.
 *
 * The clamp is load-bearing, not defensive dressing: a limit of 0 spawns no
 * workers and this returns a sparse array, which downstream `filter`/`reduce`
 * silently treat as "everything failed" rather than throwing. Callers validate
 * too, but the guarantee belongs here.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  // NaN has to be handled explicitly: Math.min(NaN, n) is NaN, Math.max(1, NaN)
  // is NaN, and Array.from({length: NaN}) coerces to zero workers — straight
  // back to the sparse array this clamp exists to prevent.
  const safe = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const workers = Array.from({ length: Math.max(1, Math.min(safe, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- Public entry point ----

export async function runEvals(clientId: string, withJudge = true): Promise<EvalRun> {
  const cfg = getClientConfig(clientId);
  if (!cfg) throw new Error(`Unknown client: ${clientId}`);
  const seed = getSeed(clientId);
  const started = Date.now();

  const results = await mapLimit(seed.goldens, evalConcurrency(), (g) =>
    evaluate(cfg, g, withJudge)
  );

  const total = results.length;
  const rate = (n: number) => (total ? n / total : 0);
  const judged = results.filter((r) => r.correctness !== null);
  const withDocs = results.filter((r) => r.correctDocsCited !== null);
  const faithJudged = results.filter((r) => r.faithful !== null);

  const correctness: Record<Correctness, number> = { correct: 0, partial: 0, incorrect: 0 };
  for (const r of judged) correctness[r.correctness!]++;
  // Judging was asked for, the question was gradeable, and no verdict came back.
  const ungraded = withJudge
    ? results.filter((r) => !r.isProbe && !r.refused && !r.error && r.correctness === null).length
    : 0;

  return {
    clientId,
    clientName: cfg.name,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    judged: withJudge,
    // Without these a pass rate cannot be compared against another run.
    config: {
      llm: `${llmProvider()} · ${llmModel()}`,
      judge: withJudge ? `${judgeTarget().provider} · ${judgeTarget().model}` : "off",
      embeddings: `${embedProvider()} · ${embedModelName()}`,
      vectorStore: vectorStoreKind(),
      chunker: `${CHUNKER_VERSION} · max ${maxChunkChars()} chars`,
      topK: TOP_K,
      relevanceThreshold: relevanceThreshold(),
    },
    results,
    summary: {
      total,
      passed: results.filter((r) => r.pass).length,
      passRate: rate(results.filter((r) => r.pass).length),
      refusalAccuracy: rate(results.filter((r) => r.refusalCorrect).length),
      citationValidity: rate(results.filter((r) => r.citationsValid).length),
      correctDocRate: withDocs.length
        ? withDocs.filter((r) => r.correctDocsCited).length / withDocs.length
        : null,
      correctness,
      ungraded,
      faithfulness: faithJudged.length
        ? faithJudged.filter((r) => r.faithful).length / faithJudged.length
        : null,
      hallucinationRate: faithJudged.length
        ? faithJudged.filter((r) => !r.faithful).length / faithJudged.length
        : null,
      avgTopScore: total ? results.reduce((n, r) => n + r.topScore, 0) / total : 0,
      avgContextChars: total
        ? Math.round(results.reduce((n, r) => n + r.contextChars, 0) / total)
        : 0,
      avgMs: total ? Math.round(results.reduce((n, r) => n + r.ms, 0) / total) : 0,
    },
  };
}
