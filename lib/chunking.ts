// Clause-aware chunking.
//
// Contracts are not prose. They are numbered clauses, each a self-contained
// obligation, and a splitter that cuts every N tokens ignores that completely.
// Measured on data/blue-harbor-retail/contracts with the previous
// SentenceSplitter: 12 chunks, median 4,499 characters, and one single chunk
// holding 16 unrelated clauses (3.3, 4.1 … 8.1) — payment terms, delivery,
// warranties and termination fused into one vector. Cutting on clause
// boundaries instead gives 103 chunks with a median of 311 characters.
//
// Two invariants hold everything together:
//
//   1. Every chunk is a VERBATIM, contiguous substring of the document.
//      The source viewer locates a chunk by searching the document for its
//      snippet, so a chunk carrying a synthetic prefix ("Retail Lease — 2.2 …")
//      would simply never be found and the citation highlight would vanish.
//      That rules out the usual trick of prepending a heading to every piece;
//      the clause number is already the first thing in the text anyway.
//   2. No chunk exceeds maxChunkChars(). This is not tidiness — see below.

import { embedProvider } from "./providers";

/**
 * Bump when the algorithm changes. It is part of the Postgres fingerprint, so
 * an existing index is rebuilt instead of serving chunks from the old splitter.
 */
export const CHUNKER_VERSION = "clause-1";

/**
 * Hard ceiling on chunk size, in characters.
 *
 * Embedding models silently truncate input past their context window — no
 * error, no warning. Measured on Xenova/all-MiniLM-L6-v2 (512 tokens), which
 * is what EMBED_PROVIDER=local uses, against a real 4,680-char chunk:
 *
 *   chunk: 4,680 chars → 1,002 tokens
 *   cosine(full chunk, first 512 tokens only) = 1.000000   ← identical
 *   cosine(full chunk, the discarded tail)    = 0.660784   ← real, different text
 *
 * The back half of every such chunk was invisible to semantic search. (BM25 saw
 * it, which is part of why hybrid retrieval helped as much as it did.)
 *
 * Prose in these contracts runs ~4.7 chars/token, but density varies: the
 * table-of-contents pages hit 3.09 chars/token (digits and dot leaders cost a
 * token each). Sizing for the worst observed density, 512 × 3.09 ≈ 1,583, so
 * 1,500 is airtight rather than merely usually-fine.
 *
 * OpenAI and Voyage allow far more, but smaller chunks are sharper regardless,
 * so they only get a moderate raise.
 */
const MAX_BY_PROVIDER: Record<string, number> = {
  local: 1500, // 512-token model — the binding constraint
  openai: 3000, // text-embedding-3-small allows 8,191 tokens
  voyage: 3000,
};

export function maxChunkChars(): number {
  const fallback = MAX_BY_PROVIDER[embedProvider()] ?? 1500;
  const raw = process.env.MAX_CHUNK_CHARS?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  // A NaN cap would compare false everywhere and silently disable the ceiling,
  // reintroducing the truncation above.
  if (!Number.isFinite(parsed) || parsed < 200) {
    console.warn(
      `[chunking] MAX_CHUNK_CHARS="${raw}" is not a usable number — using the ` +
        `${embedProvider()} default ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

/**
 * Below this a chunk is too thin to stand on its own ("Either party may
 * terminate." — of what?), so it is merged into its neighbour. This is also
 * what absorbs tables of contents: in data/contracts the median "clause" is 63
 * characters because the TOC lists every clause number, and those runs of
 * one-line entries collapse back into a single chunk here.
 */
const MIN_CHUNK_CHARS = 300;

// ---- Where we are allowed to cut ----
//
// All anchored to the start of a line. That is the load-bearing detail: a
// cross-reference inside a sentence ("as described in Section 2.2 above") must
// never split a clause in half, and only line-anchoring rules that out.

/** "2.2 Automatic Renewal", "9.16.3 Governing Law", "12. TERMINATION", "ARTICLE 4 Services". */
const CLAUSE_HEAD = /^[ \t]*(?:(?:ARTICLE|SECTION)[ \t]+\d{1,2}|\d{1,2}(?:\.\d{1,3})*\.?)[ \t]+(?=[A-Z])/gm;

/** "(a) ", "(ii) ", "(3) " — the level below a clause. */
const SUBCLAUSE_HEAD = /^[ \t]*\((?:[a-z]{1,3}|[ivxlcdm]{1,6}|\d{1,2})\)[ \t]+/gm;

/** A blank line. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;

/** End of sentence followed by the start of another. */
const SENTENCE_BREAK = /(?<=[.;:!?])[ \t]*\n|(?<=[.;:!?])[ \t]+(?=["(A-Z])/g;

/** Offsets where a match STARTS (the heading belongs to the piece it opens). */
function cutsAtMatch(text: string, re: RegExp): number[] {
  return [...text.matchAll(re)].map((m) => m.index!).filter((i) => i > 0 && i < text.length);
}

/** Offsets where a match ENDS (the separator belongs to the piece it closes). */
function cutsAfterMatch(text: string, re: RegExp): number[] {
  return [...text.matchAll(re)]
    .map((m) => m.index! + m[0].length)
    .filter((i) => i > 0 && i < text.length);
}

const clauseCuts = (t: string) => cutsAtMatch(t, CLAUSE_HEAD);
const subclauseCuts = (t: string) => cutsAtMatch(t, SUBCLAUSE_HEAD);
const paragraphCuts = (t: string) => cutsAfterMatch(t, PARAGRAPH_BREAK);
const sentenceCuts = (t: string) => cutsAfterMatch(t, SENTENCE_BREAK);

/** Contiguous verbatim slices — concatenating the result reproduces `text`. */
function sliceAt(text: string, cuts: number[]): string[] {
  if (cuts.length === 0) return [text];
  const sorted = [...new Set(cuts)].sort((a, b) => a - b);
  const out: string[] = [];
  let prev = 0;
  for (const cut of sorted) {
    out.push(text.slice(prev, cut));
    prev = cut;
  }
  out.push(text.slice(prev));
  return out;
}

/**
 * When a single clause blows past the cap, keep cutting at progressively finer
 * boundaries rather than giving up and truncating. Real example: clause 9.16.3
 * of the Master Services Agreement in data/contracts is 16,589 characters.
 */
const CASCADE = [subclauseCuts, paragraphCuts, sentenceCuts];

function enforceMax(text: string, max: number, level = 0): string[] {
  if (text.length <= max) return [text];
  if (level >= CASCADE.length) return hardWrap(text, max);
  const parts = sliceAt(text, CASCADE[level](text));
  // This level found no boundary at all — try the next one on the same text.
  if (parts.length <= 1) return enforceMax(text, max, level + 1);
  return parts.flatMap((p) => enforceMax(p, max, level + 1));
}

/** Last resort: a clause with no internal structure. Break on whitespace. */
function hardWrap(text: string, max: number): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + max);
    if (end < text.length) {
      // `end - 1`, not `end`: lastIndexOf is INCLUSIVE of its start position, so
      // a space sitting exactly at at+max gave end = space + 1 and a slice of
      // max + 1 characters. The cap is sized against the embedding model's
      // 512-token truncation cliff, so a one-character overshoot is a broken
      // invariant, not a rounding detail.
      const space = text.lastIndexOf(" ", end - 1);
      if (space > at) end = space + 1;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/**
 * Fold runs of thin fragments together, while respecting the cap.
 *
 * Thin pieces merge BACKWARD, into the chunk before them. That has a real cost,
 * and it was measured rather than assumed. In the Transportation MSA, clause 10
 * exceeds the cap, so enforceMax subdivides it and its first four sub-pieces are
 * all under MIN_CHUNK_CHARS — the heading "10. Insurance and Indemnity.", then
 * (a), (i), (ii). All four get absorbed into clause 9, producing a chunk that
 * OPENS with "9. Loss of Product" and hides every insurance obligation in its
 * tail. Search ranks it #13 for "which contracts include insurance
 * obligations?", and a cross-encoder reranker scores it lower still — both are
 * reading a chunk that is, on its face, about loss of product.
 *
 * Merging such headings FORWARD instead was tried, so that every chunk opens
 * with its own heading. It produced visibly better chunks and measured WORSE:
 *
 *                              insurance Q   liability Q (via neighbours)
 *   backward (this code)         missed         FOUND
 *   forward (heading-first)      missed         MISSED
 *
 * It never fixed the question that motivated it, and it broke one that worked:
 * re-cutting shifted every downstream boundary, so clause 5.5.1 of the MSA no
 * longer sat next to a chunk that retrieval finds. Do not re-apply it without
 * re-running that comparison.
 */
function mergeSmall(pieces: string[], max: number): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    const tooThin = last !== undefined && (last.length < MIN_CHUNK_CHARS || piece.length < MIN_CHUNK_CHARS);
    if (tooThin && last.length + piece.length <= max) out[out.length - 1] = last + piece;
    else out.push(piece);
  }
  return out;
}

// Chunk overlap was tried and REMOVED — do not re-add it without measuring.
//
// The reasoning was sound: splitting on clause boundaries means clauses that
// used to share a chunk no longer do, so an answer straddling two of them can
// retrieve one and miss the other. Real case — "What is the warehouse lease
// term and is there auto-renewal?" retrieves clause 6.1 (the 10-year term) at
// rank 1 while 6.2 (renewal for successive 3-year periods) misses the top 5, and
// the model correctly reports the renewal part as not found.
//
// Carrying 200 characters of the next clause into each chunk made things worse
// on every axis measured over 12 golden questions and 4 off-topic ones:
//
//                          evidence   context   relevant-min   off-topic-max
//   no overlap                61%      3,824       0.448          0.546
//   200-char overlap          56%      4,545       0.388          0.516
//
// Duplicated text inflates BM25 document lengths and blurs the very chunk
// boundaries the split exists to sharpen. The straddling-answer gap is real but
// wants a different fix — retrieving a chunk's neighbours at query time, which
// leaves the stored chunks sharp.

/**
 * Split one document into chunks.
 *
 * Clause boundaries are preferred cut points, not the only ones: oversized
 * clauses are subdivided and undersized ones are merged, so the cap always
 * holds without shredding a clause that already fits.
 */
export function splitDocument(text: string, max = maxChunkChars()): string[] {
  const clauses = sliceAt(text, clauseCuts(text));
  const sized = clauses.flatMap((c) => enforceMax(c, max));
  return mergeSmall(sized, max).filter((p) => p.trim().length > 0);
}
