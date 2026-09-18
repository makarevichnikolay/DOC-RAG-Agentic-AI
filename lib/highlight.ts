// Locating a cited fragment inside the source document.
//
// Extracted from the Ask screen so the Discussion screen uses the SAME
// implementation rather than a copy — a second copy would drift, and a citation
// that highlights the wrong clause is the failure this logic exists to prevent.

import type { Source } from "./types";

export type Span = { start: number; end: number };

export function locateSnippet(
  text: string,
  snippet: string
): { start: number; end: number } | null {
  // Whitespace-collapsed copy of the document, plus map[i] = the raw offset each
  // collapsed character came from.
  //
  // Written with a flag and a join rather than the obvious `hay += ch` /
  // `hay.endsWith(" ")`, which was QUADRATIC: endsWith ran against a string
  // growing to 110,425 characters on the largest contract, once per character.
  // Measured on that document, same output either way:
  //
  //   hay += ch  +  hay.endsWith(" ")   576.1 ms
  //   parts.push +  lastWasSpace flag     8.3 ms
  //
  // Callers should still memoise this — 8 ms per keystroke is fine, 576 ms is a
  // visibly frozen input — but the function should not be quadratic either way.
  const map: number[] = [];
  const parts: string[] = [];
  // Starts true so leading whitespace is skipped, matching the old
  // `hay.length === 0` condition.
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      parts.push(" ");
      map.push(i);
      lastWasSpace = true;
    } else {
      parts.push(ch.toLowerCase());
      map.push(i);
      lastWasSpace = false;
    }
  }
  const hay = parts.join("");
  let needle = snippet.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return null;
  if (needle.length > 120) needle = needle.slice(0, 120);
  let idx = hay.indexOf(needle);
  if (idx === -1 && needle.length > 60) {
    needle = needle.slice(0, 60);
    idx = hay.indexOf(needle);
  }
  if (idx === -1) return null;
  const endMapIdx = Math.min(idx + needle.length - 1, map.length - 1);
  return { start: map[idx], end: map[endMapIdx] + 1 };
}

const STOP = new Set(
  "the a an and or of to in for on at by with from that this these those is are was were be been being as it its their our your they them we you shall will may must can could would should not no any all each which who whose what when where how than then thereof herein hereto hereof pursuant such other into out agreement contract clause section article document documents provided source relevant contains contain defined define terms term".split(
    /\s+/
  )
);

function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/\d+(?:\.\d+)?|[a-z][a-z0-9/]*[a-z0-9]/g) || []).filter(
    (w) => w.length >= 3 && !STOP.has(w)
  );
}
function quotedPhrases(s: string): string[] {
  return Array.from(s.matchAll(/["“”']([^"“”']{3,60})["“”']/g))
    .map((m) => m[1].trim().toLowerCase())
    .filter(Boolean);
}

// Highlight the citation the user clicked.
//
// Two steps, in this order — the order is the whole point:
//   1. Locate the chunk that retrieval ACTUALLY returned, by searching for the
//      snippet. The snippet is a literal copy of the chunk's opening, so this is
//      an exact lookup, not a guess.
//   2. Inside that chunk only, pick the line that best matches the answer, so the
//      jump lands on the precise clause rather than the top of a long chunk.
//
// Step 2 used to run over the WHOLE document, with step 1 as a fallback. That
// let a citation land anywhere: asked about renewal, the scorer highlighted an
// insurance clause in a different contract simply because it shared the words
// "deliver", "notice", "renewal" and "days". Scoring can now only ever choose
// between lines that were genuinely retrieved.
export function bestHighlight(
  text: string,
  answer: string,
  snippet: string,
  chunkChars: number
): { start: number; end: number } | null {
  const chunk = locateSnippet(text, snippet);
  if (!chunk) return null; // snippet isn't in this document — highlight nothing

  // The snippet match only covers the chunk's opening; extend to the full chunk.
  const chunkStart = chunk.start;
  const chunkEnd = Math.min(text.length, chunkStart + Math.max(chunkChars, snippet.length));

  const body = answer.split(/\(\s*source/i)[0];
  const weights = new Map<string, number>();
  for (const t of contentTokens(body)) {
    const w = /\d/.test(t) ? 7 : Math.min(t.length, 10);
    weights.set(t, Math.max(weights.get(t) || 0, w));
  }
  const phrases = quotedPhrases(body);

  let off = 0;
  let best: { start: number; end: number } | null = null;
  let bestScore = 0;
  for (const ln of text.split("\n")) {
    const start = off;
    const end = off + ln.length;
    off = end + 1;
    if (start < chunkStart || end > chunkEnd) continue; // outside the retrieved chunk
    const low = ln.toLowerCase();
    if (low.trim().length < 4) continue;
    let s = 0;
    for (const [t, w] of weights) if (low.includes(t)) s += w;
    for (const p of phrases) if (low.includes(p)) s += 25;
    if (s > bestScore) {
      bestScore = s;
      best = { start, end };
    }
  }

  // A confident line inside the chunk, else the chunk itself — either way the
  // highlight stays within text that was really retrieved.
  if (best && bestScore >= 7) return best;
  return { start: chunkStart, end: chunkEnd };
}

/**
 * What the source viewer needs in order to open a document at a fragment.
 *
 * `chunkChars` is the RAW length of the whole retrieved chunk — the viewer adds
 * it to a raw offset in the document, so a whitespace-collapsed length would cut
 * the highlight window short.
 */
export type Selected = {
  fileName: string;
  title: string;
  snippet: string;
  chunkChars: number;
  /** Namespaced per screen so two citation lists cannot collide. */
  key: string;
};

/**
 * One citation button per document, keeping the BEST chunk for each.
 *
 * Order matters, and it is not arbitrary: lib/rag.ts builds `sources` from the
 * ranked retrieval hits first, then APPENDS neighbour-expansion chunks — the
 * paragraphs pulled in merely because they sit next to a good hit. A neighbour
 * always carries the fileName of the chunk that pulled it in, so every document
 * that got expanded appears at least twice in this list.
 *
 * Keeping the FIRST match is therefore the whole point. Building a Map from the
 * same array keeps the LAST one, which is always the neighbour: a chunk
 * retrieval never returned, with score null (so the button reads "BM25") and a
 * snippet that highlights the passage BESIDE the answer. That was a real bug on
 * the Discussion screen; it lives here now so both screens cannot disagree
 * about it again.
 */
export function dedupeByDoc(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!seen.has(s.fileName)) {
      seen.add(s.fileName);
      out.push(s);
    }
  }
  return out;
}
