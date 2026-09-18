// Online monitoring — what REAL users actually asked, and what they got.
//
// This is deliberately a different thing from lib/evals.ts, and the difference
// is the whole reason this file exists:
//
//   evals    a fixed set of golden questions, run on demand, graded against
//            expected answers. Answers "did I break anything?"
//   monitor  every real query as it happens, ungraded. Answers "are users
//            getting bad answers RIGHT NOW?"
//
// Evals cannot answer the second question, because the golden questions never
// change and real users ask things nobody wrote a golden for. A pipeline can
// score 13/14 on evals while refusing half of what real users type.
//
// What makes this worth having on THIS pipeline is `refusedBy` (lib/types.ts).
// A refusal is not one event, it is two very different bugs:
//
//   refusedBy: "guardrail"  the best semantic score fell under the threshold,
//                           so no model call happened. A RETRIEVAL/THRESHOLD
//                           problem — the answer may well be in the documents.
//   refusedBy: "model"      retrieval passed, the model read the excerpts and
//                           found nothing. A CONTENT problem — or a genuine
//                           "we don't have that", which is correct behaviour.
//
// A rising guardrail rate means the threshold is wrong for real traffic. A
// rising model-refusal rate means people are asking about documents that are not
// loaded. Same symptom on screen, opposite fixes. Most RAG dashboards cannot
// tell them apart; this one can, so it must not collapse them into one number.
//
// PRIVACY — question text is recorded for EVERY surface, Discussion included.
// What stays browser-only is the Discussion TRANSCRIPT: the running back-and-
// forth, which is never written to the server and is dropped when the user
// leaves the page, switches client or ends the session. Individual questions are
// recorded here, exactly as Ask questions are, so refusals and slow queries can
// be investigated. The Discussion screen's footer states this plainly; those two
// must be changed together or the app promises something it does not do.
// Set MONITOR_STORE_QUESTIONS=off to record no question text at all.

import { vectorStoreKind } from "./vector-store";

/** Which screen a query came from. Kept separate because privacy differs. */
export type Surface = "ask" | "discuss" | "portfolio";

export type QueryEvent = {
  /** ISO timestamp, second precision — matches the audit log's format. */
  time: string;
  clientId: string;
  surface: Surface;
  /** The question as typed. Null when MONITOR_STORE_QUESTIONS=off. */
  question: string | null;
  /**
   * The standalone question retrieval actually ran on, when it differed from
   * what was typed — Discussion rewrites follow-ups before searching. Undefined
   * everywhere else. `topScore` belongs to THIS text, not to `question`.
   */
  searchedFor?: string;
  /** Best semantic score across candidates, the number the guardrail tests. */
  topScore: number;
  refused: boolean;
  /** Only meaningful when refused. See the header note — this is the point. */
  refusedBy?: "guardrail" | "model";
  /** Documents cited in the answer. 0 on a refusal. */
  sources: number;
  /** Wall-clock time for the whole pipeline, including the model call. */
  latencyMs: number;
  /** Set when the request threw instead of answering. */
  error?: string;
};

export type MonitorSummary = {
  total: number;
  refused: number;
  /** Split out on purpose — see the header. */
  refusedByGuardrail: number;
  refusedByModel: number;
  errors: number;
  /** Median and 95th percentile, in ms. Averages hide the bad tail. */
  latencyP50: number;
  latencyP95: number;
  /** Mean top score over non-error queries — drift here precedes refusal spikes. */
  avgTopScore: number;
  /** Queries whose top score landed within NEAR_MISS of the threshold. */
  nearThreshold: number;
};

export interface MetricStore {
  record(event: QueryEvent): Promise<void>;
  recent(opts?: { clientId?: string; limit?: number }): Promise<QueryEvent[]>;
  summary(opts?: { clientId?: string }): Promise<MonitorSummary>;
  /** Drops one client's events, or every client's when no id is given. */
  clear(opts?: { clientId?: string }): Promise<void>;
}

/**
 * How close to the threshold counts as a near miss.
 *
 * Not arbitrary: the README records two off-topic probes at 0.412 and 0.413
 * against a 0.40 threshold, and the lowest relevant golden at 0.448. So the
 * interesting band is roughly 0.05 wide — wide enough to catch the questions
 * that only just survived the guardrail, narrow enough not to flag everything.
 */
const NEAR_THRESHOLD_BAND = 0.05;

/** Upper bound on ?limit, and the value used when it is absent or unusable. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * Parse ?limit, falling back to DEFAULT_LIMIT when it is absent or unusable.
 *
 * Written the long way because the obvious version is wrong:
 *
 *   const raw = Number(url.searchParams.get("limit"));
 *   const limit = Number.isFinite(raw) ? clamp(raw) : DEFAULT_LIMIT;
 *
 * `searchParams.get` returns null for a missing param, and `Number(null)` is 0
 * — NOT NaN. So `Number.isFinite` passes, the default branch never runs, and the
 * clamp turns 0 into 1: every request with no ?limit returned exactly ONE row
 * while the summary counted them all. `Number("")` is 0 too, so a blank
 * `?limit=` did the same. Same shape as the blank-env-var bugs elsewhere in this
 * codebase: an absent value coercing to a valid-looking number.
 */
export function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

/** Cap on retained events in the memory backend. */
const MEMORY_CAP = 500;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank. With a handful of events an interpolating percentile invents
  // precision that isn't there.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarise(events: QueryEvent[], threshold: number): MonitorSummary {
  const answered = events.filter((e) => !e.error);
  const latencies = events.map((e) => e.latencyMs).sort((a, b) => a - b);
  const scores = answered.map((e) => e.topScore);
  return {
    total: events.length,
    refused: events.filter((e) => e.refused).length,
    refusedByGuardrail: events.filter((e) => e.refusedBy === "guardrail").length,
    refusedByModel: events.filter((e) => e.refusedBy === "model").length,
    errors: events.filter((e) => e.error).length,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    avgTopScore: scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0,
    nearThreshold: answered.filter(
      (e) => e.topScore >= threshold && e.topScore < threshold + NEAR_THRESHOLD_BAND
    ).length,
  };
}

/**
 * In-process ring buffer.
 *
 * Module state, so it is per server process and resets on restart — exactly like
 * VECTOR_STORE=memory, and it must be LABELLED as such in the UI. A monitoring
 * page that silently loses yesterday's data is worse than one that admits it.
 */
class MemoryMetricStore implements MetricStore {
  private events: QueryEvent[] = [];

  async record(event: QueryEvent): Promise<void> {
    // Newest first, matching the audit log, so "recent" needs no re-sort.
    this.events.unshift(event);
    if (this.events.length > MEMORY_CAP) this.events.length = MEMORY_CAP;
  }

  async recent(opts: { clientId?: string; limit?: number } = {}): Promise<QueryEvent[]> {
    const { clientId, limit = 50 } = opts;
    const scoped = clientId ? this.events.filter((e) => e.clientId === clientId) : this.events;
    return scoped.slice(0, limit);
  }

  async summary(opts: { clientId?: string } = {}): Promise<MonitorSummary> {
    const scoped = opts.clientId
      ? this.events.filter((e) => e.clientId === opts.clientId)
      : this.events;
    return summarise(scoped, relevanceThresholdForDisplay());
  }

  async clear(opts: { clientId?: string } = {}): Promise<void> {
    // Scoped when an id is given. A "Clear" button pressed on a page that says
    // "Northwind Logistics only" must not wipe the other tenants' metrics.
    this.events = opts.clientId
      ? this.events.filter((e) => e.clientId !== opts.clientId)
      : [];
  }
}

/**
 * The threshold the summary compares against.
 *
 * Read lazily from the same env var the guardrail uses rather than imported from
 * lib/providers.ts, because that module configures embeddings as a side effect
 * and this one must stay cheap enough to call on every request.
 */
function relevanceThresholdForDisplay(): number {
  const raw = process.env.RELEVANCE_THRESHOLD?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  // Mirrors THRESHOLD_BY_PROVIDER in lib/providers.ts. Only used to bucket
  // "near threshold" for display; the real guardrail always uses its own value.
  //
  // The fallback is "openai", which is what embedProvider() defaults to — NOT
  // "local". Getting that wrong is not cosmetic: with EMBED_PROVIDER unset the
  // guardrail runs at 0.28 while this page would claim 0.40 and bucket
  // "near threshold" over [0.40, 0.45), a band with no relationship to the real
  // boundary. It would miss every genuine near miss and flag safe queries.
  const provider = (process.env.EMBED_PROVIDER?.trim() || "openai").toLowerCase();
  return provider === "local" ? 0.4 : 0.28;
}

/**
 * The store is pinned to `globalThis`, not to a module-level `let`.
 *
 * Next.js re-evaluates server modules on every recompile, and a route handler
 * can hold its own instance of an imported module. With plain module state the
 * result is that /api/query writes into one array while /api/monitor reads a
 * different (often empty) one, and every file save silently resets the metrics
 * mid-session. `globalThis` survives both, because it belongs to the process
 * rather than the module graph. This is the same singleton pattern the Next.js
 * docs recommend for database clients, and for the same reason.
 */
const GLOBAL_KEY = Symbol.for("contract-intel.metric-store");

type StoreHolder = { [GLOBAL_KEY]?: MetricStore };

export function metricStore(): MetricStore {
  const holder = globalThis as unknown as StoreHolder;
  const existing = holder[GLOBAL_KEY];
  if (existing) return existing;
  // Selected by the SAME env var as the vector store, so there is one answer to
  // "is this deployment persistent?" rather than two that can disagree.
  // Postgres is not implemented yet: it falls back to memory and says so, which
  // is safer than silently pretending a query_events table exists.
  const kind = vectorStoreKind();
  if (kind === "postgres") {
    console.warn(
      "[monitor] VECTOR_STORE=postgres, but the Postgres metric store is not " +
        "implemented yet — monitoring is in-process and resets on restart."
    );
  }
  const created = new MemoryMetricStore();
  holder[GLOBAL_KEY] = created;
  return created;
}

/**
 * True when question text may be stored for this surface.
 *
 * Every surface is treated alike, Discussion included. That is a deliberate
 * product decision, not an oversight: an operator cannot act on "a Discussion
 * query scored 0.41 and was refused" without knowing what was asked. The cost is
 * that the Discussion screen can no longer claim its questions never reach the
 * server, so its footer says what actually happens instead — if you change this
 * back, change that text with it.
 *
 * MONITOR_STORE_QUESTIONS=off still turns recording off everywhere.
 */
export function mayStoreQuestion(_surface: Surface): boolean {
  return (process.env.MONITOR_STORE_QUESTIONS?.trim() || "on").toLowerCase() !== "off";
}

/**
 * Record one query. Never throws.
 *
 * Monitoring is an observer: a failure to write a metric must not turn a good
 * answer into a 500 for the user. Callers therefore do not need to wrap it.
 */
export async function recordQuery(event: QueryEvent): Promise<void> {
  try {
    // Both text fields go through the same gate. Stripping `question` while
    // leaving `searchedFor` would defeat MONITOR_STORE_QUESTIONS=off entirely on
    // the one surface that populates it.
    const keepText = mayStoreQuestion(event.surface);
    await metricStore().record({
      ...event,
      question: keepText ? event.question : null,
      searchedFor: keepText ? event.searchedFor : undefined,
    });
  } catch (err) {
    console.error("[monitor] failed to record query", err);
  }
}

export function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export { NEAR_THRESHOLD_BAND, relevanceThresholdForDisplay };
