// BM25 lexical search — the "classic text search" half of hybrid retrieval.
//
// Written in TypeScript on purpose so BOTH vector-store backends share it.
// Postgres has excellent built-in text search, but using it would mean two
// different ranking engines (Postgres stems "renewal" -> "renew", a hand-written
// tokenizer does not), and the same question could then return different
// paragraphs depending on VECTOR_STORE. One implementation, one behaviour.
//
// Trade-off, recorded deliberately: scoring happens in Node over the client's
// chunks rather than in a database index. At this corpus size (tens to hundreds
// of chunks) that is free. Past ~10k chunks per client, move the lexical half to
// a Postgres GIN index and accept the divergence.

const STOP = new Set(
  "the a an and or of to in for on at by with from that this these those is are was were be been being as it its their our your they them we you shall will may must can could would should not no any all each which who whose what when where how than then such other into out do does did have has had".split(
    /\s+/
  )
);

/**
 * Keeps numbers and dotted identifiers intact — "9.2", "2026", "$2,000,000".
 * Those are the tokens BM25 is uniquely good at and embeddings are worst at, so
 * losing them here would defeat the point of adding lexical search at all.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\d+(?:[.,]\d+)*|[a-z][a-z0-9/-]*/g) || []).filter(
    (t) => t.length >= 2 && !STOP.has(t)
  );
}

const K1 = 1.2; // term-frequency saturation
const B = 0.75; // length normalisation

export type LexicalHit = { index: number; score: number };

export class BM25Index {
  private termFreqs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private docFreq = new Map<string, number>();
  private avgLength = 0;
  private count = 0;

  constructor(documents: string[]) {
    for (const doc of documents) {
      const tokens = tokenize(doc);
      const freqs = new Map<string, number>();
      for (const t of tokens) freqs.set(t, (freqs.get(t) ?? 0) + 1);
      for (const t of freqs.keys()) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      this.termFreqs.push(freqs);
      this.lengths.push(tokens.length);
    }
    this.count = documents.length;
    const total = this.lengths.reduce((a, b) => a + b, 0);
    this.avgLength = this.count > 0 ? total / this.count : 0;
  }

  /** Rare terms score higher — this is what makes "9.2" beat "agreement". */
  private idf(term: string): number {
    const n = this.docFreq.get(term) ?? 0;
    if (n === 0) return 0;
    return Math.log(1 + (this.count - n + 0.5) / (n + 0.5));
  }

  /** Top-k documents by BM25, best first. Documents scoring 0 are omitted. */
  search(query: string, k: number): LexicalHit[] {
    if (this.count === 0) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const scored: LexicalHit[] = [];
    for (let i = 0; i < this.count; i++) {
      const freqs = this.termFreqs[i];
      const len = this.lengths[i];
      let score = 0;
      for (const term of terms) {
        const f = freqs.get(term);
        if (!f) continue;
        const denom = f + K1 * (1 - B + (B * len) / (this.avgLength || 1));
        score += this.idf(term) * ((f * (K1 + 1)) / denom);
      }
      if (score > 0) scored.push({ index: i, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

// ---- Reciprocal Rank Fusion ----
//
//   RRF_score(d) = Σ  1 / (k + rank_i(d))
//
// Fuses by RANK, not score, which is exactly why it works here: a cosine
// similarity of 0.42 and a BM25 score of 7.8 are not comparable numbers, but
// "3rd place" and "1st place" are. k=60 is the value from the original paper and
// the de-facto default; it damps the difference between the top few ranks so a
// single retriever cannot dominate the merged list.
export const RRF_K = Number(process.env.RRF_K ?? "60");

export type Ranking = { index: number }[];

export type FusedHit = {
  index: number;
  rrf: number;
  /** Which retrievers found it — shown in the Inspector. */
  ranks: (number | null)[];
};

export function reciprocalRankFusion(rankings: Ranking[], k = RRF_K): FusedHit[] {
  const acc = new Map<number, FusedHit>();

  rankings.forEach((ranking, listIdx) => {
    ranking.forEach((hit, position) => {
      const rank = position + 1; // 1-based, per the formula
      let entry = acc.get(hit.index);
      if (!entry) {
        entry = { index: hit.index, rrf: 0, ranks: rankings.map(() => null) };
        acc.set(hit.index, entry);
      }
      entry.rrf += 1 / (k + rank);
      entry.ranks[listIdx] = rank;
    });
  });

  return Array.from(acc.values()).sort((a, b) => b.rrf - a.rrf);
}
