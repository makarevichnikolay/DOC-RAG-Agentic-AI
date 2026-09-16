// Neighbour expansion: after retrieval, also hand the model the clause either
// side of its best hits.
//
// Why this is needed at all is a consequence of clause-aware chunking. Clauses
// that used to share one big chunk are now separate, and contracts are full of
// clauses that only make sense next to their neighbour:
//
//   6.1  "The lease ... shall start on 1 September 2020 ... for an initial
//         period of 10 years"                                    ← ranks #1
//   6.2  "Following the expiry of the 10 year period referred to in Article
//         6.1. above, this Agreement will be automatically extended for
//         subsequent periods of 3 years"                         ← ranks #62
//
// 6.2 holds the answer to "is there auto-renewal?" and is nearly unfindable on
// its own: it never says "warehouse" or "lease term", it just points backwards.
// Same shape in the MSA — 5.5.2 "Exclusions from Liability Limitations" ranks
// #3 while 5.5.1, the clause that actually excludes consequential damages,
// ranks #25 because its heading is "Disclaimer of Non-Direct Damages".
//
// Measured on the 8 golden questions of northwind-logistics:
//
//   widening the candidate pool 15 -> 30 -> 80   both clauses still missed
//   neighbours (±1 chunk)                        both found, 3,790 -> 9,343 chars
//   whole parent section                         both found, but one section in
//                                                these contracts is 14,249 chars
//
// Hence neighbours rather than parent sections: every chunk is capped at
// maxChunkChars(), so ±1 adds a bounded amount of text. A parent section has no
// such ceiling.
//
// This is a targeted fix, not a general search improvement: it only helps when
// the answer sits next to something retrieval already found.

/** The minimum a chunk must expose for adjacency to be computable. */
export type Adjacent = { fileName: string };

export type NeighbourPick<T> = {
  /** The neighbouring chunk itself. */
  chunk: T;
  /** Which retrieved chunk pulled it in (its rank, 1-based). */
  becauseOfRank: number;
};

/**
 * Pick the neighbours of the highest-ranked hits.
 *
 * @param ranked   retrieved chunks, best first
 * @param all      every chunk for this client, in DOCUMENT order
 * @param keyOf    identity of a chunk, used to avoid returning duplicates
 * @param topN     how many of `ranked` to expand. Deliberately small.
 * @param radius   how many chunks either side.
 *
 * Neighbours never cross a document boundary: `all` is one flat array holding
 * every document, so position ±1 at a document's edge lands in a different
 * contract entirely. The fileName check is what prevents that.
 */
export function pickNeighbours<T extends Adjacent>(
  ranked: T[],
  all: T[],
  keyOf: (chunk: T) => string,
  topN: number,
  radius: number
): NeighbourPick<T>[] {
  if (topN <= 0 || radius <= 0) return [];

  const positionOf = new Map<string, number>();
  all.forEach((c, i) => {
    const k = keyOf(c);
    // First occurrence wins: a duplicated chunk should not relocate the index.
    if (!positionOf.has(k)) positionOf.set(k, i);
  });

  const seen = new Set(ranked.map(keyOf));
  const out: NeighbourPick<T>[] = [];

  ranked.slice(0, topN).forEach((chunk, i) => {
    const at = positionOf.get(keyOf(chunk));
    if (at === undefined) return;
    for (let d = -radius; d <= radius; d++) {
      if (d === 0) continue;
      const neighbour = all[at + d];
      if (!neighbour) continue;
      // Never bleed into the next contract.
      if (neighbour.fileName !== chunk.fileName) continue;
      const k = keyOf(neighbour);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ chunk: neighbour, becauseOfRank: i + 1 });
    }
  });

  return out;
}

/**
 * How many of the top hits get expanded. 3 is the measured minimum that works,
 * not a round number — on the northwind goldens:
 *
 *   topN=2   1 of 2 target clauses found · avg context 6,347 chars
 *   topN=3   2 of 2 found                · avg context 7,082 chars   <- default
 *   topN=4   2 of 2 found                · avg context 8,091 chars
 *   topN=5   2 of 2 found                · avg context 9,045 chars
 *
 * topN=2 misses the liability clause because its neighbour, 5.5.2, ranks #3.
 * Above 3 buys nothing but tokens. Set NEIGHBOUR_TOP_N=0 to switch this off.
 */
export function neighbourTopN(): number {
  return readCount("NEIGHBOUR_TOP_N", 3);
}

/** How many chunks either side. 1 keeps the added text bounded and predictable. */
export function neighbourRadius(): number {
  return readCount("NEIGHBOUR_RADIUS", 1);
}

/**
 * Read a non-negative integer from the environment.
 *
 * `?? "3"` only covers an UNSET variable. `NEIGHBOUR_TOP_N=` (present but
 * blank, which is what you get by copying .env.example and not filling it in)
 * yields Number("") === 0 — finite and >= 0, so it passes a naive guard and
 * turns the whole feature off in silence. Meanwhile a typo like "abc" gives NaN
 * and correctly falls back. Trimming first makes both behave the same way, and
 * an explicit 0 still disables expansion on purpose.
 */
function readCount(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[neighbours] ${name}="${raw}" is not a usable number — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}
