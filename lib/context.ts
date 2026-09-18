// Assembling the excerpts the model reads.
//
// This exists for ONE reason: the string the model sees and the string the evals
// harness judges against must be the same string.
//
// They were built in three separate places in lib/rag.ts, and had already
// drifted — the model got "[1] (Title)\ntext" while the judge got
// "(Title)\ntext" with no index markers. That is not a cosmetic difference. The
// faithfulness check asks "is every claim in this answer supported by what the
// model was actually given?", and it can only answer honestly if it is given the
// same text. Judging a near-copy silently weakens the only check that catches
// hallucination.
//
// This drift has bitten once already: `context` used to be bare chunk text while
// the model received the document title too, so questions whose expected answer
// named a document ("the Warehouse Lease; the Transportation MSA") were reported
// as retrieval MISSES — blaming search for a formatting difference. That was
// fixed by adding titles in one of the three places. This file removes the other
// two so it cannot recur.
//
// Deliberately NOT in here:
//   • token counting / budget allocation — the model has a 200K window and a
//     normal context is 1-2K tokens. A budget allocator would be machinery for
//     a problem this app does not have.
//   • reranking, dedup, neighbour expansion — those decide WHICH chunks; this
//     only decides how the chosen chunks are written down.
//   • prompt templating — the system prompt lives in lib/rag.ts.

/** The minimum a chunk must have to be written into context. */
export type ContextChunk = {
  text: string;
  title: string;
};

export type BuiltContext = {
  /** Exactly what follows "Contract excerpts:" in the user message. */
  prompt: string;
  /**
   * The same blocks, unjoined — what the evals harness reads.
   * INVARIANT: prompt === blocks.join(BLOCK_SEPARATOR). Enforced by tests.
   */
  blocks: string[];
  /** Chunks written into the context. */
  included: number;
  /** Chunks dropped by the size guard. Normally 0. */
  dropped: number;
  /** Total characters in `prompt`. */
  chars: number;
};

/** Blank line between excerpts, so the model sees them as separate documents. */
export const BLOCK_SEPARATOR = "\n\n";

/**
 * Default ceiling on total context characters.
 *
 * Sized to sit above the real worst case rather than to bite in normal use: a
 * survey question takes TOP_K x 2 = 10 chunks, neighbour expansion adds up to 6
 * more, and the per-provider chunk cap is at most 3,000 chars — about 48,000
 * characters, or roughly 12K tokens. 60,000 leaves headroom while still bounding
 * a configuration mistake (a raised TOP_K, a raised chunk cap) that would
 * otherwise grow cost silently.
 */
const DEFAULT_MAX_CONTEXT_CHARS = 60_000;

/**
 * `||` not `??`, and an explicit finite check.
 *
 * MAX_CONTEXT_CHARS= (present but blank) is common in .env files and must mean
 * "default", not 0 — a 0 ceiling would drop every excerpt and turn every answer
 * into a refusal. This codebase has shipped that bug three times with other
 * variables (EVAL_CONCURRENCY, SURVEY_PER_DOC, and the ?limit parser in
 * app/api/monitor/route.ts), so it is written out rather than inlined.
 */
export function maxContextChars(): number {
  const raw = process.env.MAX_CONTEXT_CHARS?.trim();
  if (!raw) return DEFAULT_MAX_CONTEXT_CHARS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CONTEXT_CHARS;
  return Math.floor(n);
}

/**
 * One excerpt, as the model reads it.
 *
 * The `[n]` marker gives the model a stable handle per excerpt, and the title
 * carries the document name — which the clause text itself usually does not, so
 * without it "which contracts mention X?" is unanswerable from the excerpts.
 */
function formatBlock(chunk: ContextChunk, index: number): string {
  return `[${index + 1}] (${chunk.title || "document"})\n${chunk.text}`;
}

/**
 * Build the context once, for every consumer.
 *
 * Chunks arrive in the order the model should read them — lib/rag.ts places each
 * neighbour immediately after the chunk that pulled it in, because a clause that
 * says "the 10 year period referred to in Article 6.1 above" is unintelligible
 * five excerpts away from 6.1. That order is preserved exactly.
 *
 * The size guard drops WHOLE blocks from the END and never truncates one. A
 * half-excerpt is worse than a missing one: the model would read a clause that
 * stops mid-sentence and could answer from it as though it were complete.
 *
 * Two deliberate choices in that guard:
 *   • it stops at the first excerpt that does not fit and drops everything after
 *     it, rather than skipping that one and squeezing in a smaller lower-ranked
 *     excerpt. Keeping rank 7 while silently dropping rank 4 is the kind of
 *     surprise that is very hard to debug from an answer alone.
 *   • the first excerpt is always kept, however large. Returning no context at
 *     all would turn the question into a refusal and blame retrieval for a
 *     budgeting decision.
 */
export function buildContext(
  chunks: ContextChunk[],
  opts: { maxChars?: number } = {}
): BuiltContext {
  const maxChars = opts.maxChars ?? maxContextChars();

  const blocks: string[] = [];
  let chars = 0;
  let dropped = 0;

  for (let i = 0; i < chunks.length; i++) {
    const block = formatBlock(chunks[i], blocks.length);
    // The separator only costs anything once a previous block exists.
    const added = block.length + (blocks.length > 0 ? BLOCK_SEPARATOR.length : 0);
    if (blocks.length > 0 && chars + added > maxChars) {
      dropped = chunks.length - i; // this one and every excerpt after it
      break;
    }
    blocks.push(block);
    chars += added;
  }

  if (dropped > 0) {
    // Loud on purpose. Silently shrinking the evidence is how a pipeline starts
    // refusing questions it used to answer, with nothing in the logs to explain it.
    console.warn(
      `[context] dropped ${dropped} excerpt(s) to stay under ${maxChars} chars ` +
        `(kept ${blocks.length}). Raise MAX_CONTEXT_CHARS or lower TOP_K.`
    );
  }

  return {
    prompt: blocks.join(BLOCK_SEPARATOR),
    blocks,
    included: blocks.length,
    dropped,
    chars,
  };
}
