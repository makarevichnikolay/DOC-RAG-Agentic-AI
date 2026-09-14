import { BM25Index, reciprocalRankFusion } from "./bm25";
import { CLIENT_CONFIGS, getClientConfig } from "./clients";
import { generateAnswer, relevanceThreshold } from "./providers";
import { getStore, humanTitle, type ClientStore, type ScoredChunk, type StoredChunk } from "./vector-store";
import type { QueryResult, Source, PortfolioResult } from "./types";

// ---- Configuration ----
// Guardrail: if the best retrieved chunk scores below this, we refuse instead of
// guessing. The default is per embedding model (see lib/providers.ts) because
// each model has its own score distribution; RELEVANCE_THRESHOLD overrides it.
export { relevanceThreshold as RELEVANCE_THRESHOLD };
export const TOP_K = Number(process.env.TOP_K ?? "5"); // chunks fed to the LLM after rerank
const CANDIDATE_K = Math.max(12, TOP_K * 3); // wider candidate set retrieved before rerank

// ---- Hybrid retrieval: two independent searches, merged ----
//
// This replaces the old keyword-bonus rerank. The difference is not cosmetic:
// a rerank can only reorder what embeddings already returned, so a chunk that
// embeddings ranked #200 was unreachable no matter how well it matched the
// words. Running BM25 as its own retriever and fusing the two rankings means
// either half can surface a chunk on its own.
//
// That matters most for contracts, which are full of exact tokens embeddings
// handle badly: "Section 9.2", "September 30, 2026", "$2,000,000".

/** BM25 is rebuilt when the client's chunk set changes, and cached otherwise. */
type LexicalCache = { signature: string; chunks: StoredChunk[]; index: BM25Index };
const lexicalCaches = new Map<string, LexicalCache>();

async function getLexicalIndex(clientId: string, store: ClientStore): Promise<LexicalCache> {
  const chunks = await store.allChunks();
  const signature = `${chunks.length}:${chunks.reduce((n, c) => n + c.text.length, 0)}`;
  const cached = lexicalCaches.get(clientId);
  if (cached && cached.signature === signature) return cached;
  const fresh: LexicalCache = {
    signature,
    chunks,
    index: new BM25Index(chunks.map((c) => c.text)),
  };
  lexicalCaches.set(clientId, fresh);
  return fresh;
}

/** Same chunk retrieved by both halves? Match on text, which is what identifies it. */
function chunkKey(c: StoredChunk): string {
  return `${c.fileName}::${c.text.length}::${c.text.slice(0, 80)}`;
}

// Grounded, no-hallucination system behaviour. We extract facts FROM the documents,
// we cite the source, and we refuse when the documents do not contain the answer.
const SYSTEM_PROMPT = `You are a contract analysis assistant for a specific client's document set.
Rules:
- Always respond in English.
- Answer ONLY using the provided contract excerpts. Never rely on outside knowledge of law.
- If the excerpts do not contain the answer, reply exactly: "Not found in the provided documents."
- Be concise. Quote the concrete value (amount, date, term, clause) and name the source document.
- You extract what the documents SAY. You do not give legal advice or interpret the law.`;

export async function queryContracts(
  clientId: string,
  question: string
): Promise<QueryResult> {
  const cfg = getClientConfig(clientId);
  if (!cfg) throw new Error(`Unknown client: ${clientId}`);
  const store = getStore(cfg);

  // 1) Two independent searches over the same chunks, run concurrently.
  //    Semantic embeds ONLY the question (no system prompt, so the query vector
  //    is not diluted). Lexical is BM25 over the client's full chunk set.
  const lexical = await getLexicalIndex(clientId, store);
  const [semanticHits, lexicalHits] = await Promise.all([
    store.retrieve(question, CANDIDATE_K),
    Promise.resolve(lexical.index.search(question, CANDIDATE_K)),
  ]);

  // Put both rankings in the same address space so they can be fused.
  const byKey = new Map<string, StoredChunk & { score: number | null }>();
  const semanticRanking: { index: number }[] = [];
  const lexicalRanking: { index: number }[] = [];
  const order: string[] = [];
  const slot = (chunk: StoredChunk, score: number | null): number => {
    const key = chunkKey(chunk);
    let at = order.indexOf(key);
    if (at === -1) {
      at = order.push(key) - 1;
      byKey.set(key, { ...chunk, score });
    } else if (score !== null && score > (byKey.get(key)?.score ?? -1)) {
      byKey.set(key, { ...byKey.get(key)!, score });
    }
    return at;
  };
  for (const h of semanticHits) semanticRanking.push({ index: slot(h, h.score) });
  // null, not 0: BM25 tells us nothing about cosine similarity. If the semantic
  // half also found this chunk, the line above has already filled in the score.
  for (const h of lexicalHits) lexicalRanking.push({ index: slot(lexical.chunks[h.index], null) });

  // 2) Merge with Reciprocal Rank Fusion: RRF(d) = Σ 1 / (k + rank_i(d)).
  const fused = reciprocalRankFusion([semanticRanking, lexicalRanking]).slice(0, TOP_K);
  const reranked = fused.map((f) => byKey.get(order[f.index])!);

  const sources: Source[] = fused.map((f) => {
    const chunk = byKey.get(order[f.index])!;
    const flat = chunk.text.replace(/\s+/g, " ").trim();
    const [semRank, lexRank] = f.ranks;
    return {
      file: chunk.title || chunk.fileName || "document",
      fileName: chunk.fileName,
      score: chunk.score === null ? null : Number(chunk.score.toFixed(3)),
      snippet: flat.slice(0, 240),
      // #3: RAW length — the viewer offsets into un-collapsed document text.
      chunkChars: chunk.text.length,
      via: semRank !== null && lexRank !== null ? "both" : semRank !== null ? "semantic" : "lexical",
      semanticRank: semRank,
      lexicalRank: lexRank,
      rrf: Number(f.rrf.toFixed(4)),
    };
  });

  // 3) Guardrail stays on the best SEMANTIC score, deliberately.
  //    It answers "is this question about these documents at all?" — a question
  //    about meaning. BM25 will happily match an off-topic question on a stray
  //    common word ("address" appears in every contract's party block), so
  //    letting lexical hits satisfy the guardrail would let exactly the demo's
  //    refusal case through.
  const topSemantic = semanticHits.reduce((m, c) => Math.max(m, c.score), 0);
  const topScore = Number(topSemantic.toFixed(3));
  const refused = topScore < relevanceThreshold() || reranked.length === 0;

  if (refused) {
    return {
      answer: "Not found in the provided documents.",
      refused: true,
      sources,
      topScore,
    };
  }

  // 4) Grounded synthesis over the reranked chunks (system prompt kept separate).
  const context = reranked
    .map((chunk, i) => `[${i + 1}] (${chunk.title || "document"})\n${chunk.text}`)
    .join("\n\n");

  const answer = await generateAnswer(
    SYSTEM_PROMPT,
    `Contract excerpts:\n\n${context}\n\nQuestion: ${question}`
  );

  // If the model itself couldn't find the answer, present it as a clean refusal.
  const modelRefused = /not found in the provided documents/i.test(answer);
  return {
    answer,
    refused: modelRefused,
    sources: modelRefused ? [] : sources,
    topScore,
  };
}

// ---- Live ingestion of an uploaded (OCR'd) document ----
// The recognized text is inserted into the client's store, so the very next query
// can retrieve it. We also keep the raw text so the document viewer can show an
// uploaded file that has no copy on disk. With VECTOR_STORE=postgres both survive
// a restart; with the in-memory store they do not.
export type IngestResult = {
  fileName: string;
  title: string;
  chars: number;
  preview: string;
};

export async function getUploadedDoc(clientId: string, fileName: string) {
  const cfg = getClientConfig(clientId);
  if (!cfg) return null;
  return getStore(cfg).getUploaded(fileName);
}

export async function ingestDocument(
  clientId: string,
  fileName: string,
  text: string
): Promise<IngestResult> {
  const cfg = getClientConfig(clientId);
  if (!cfg) throw new Error(`Unknown client: ${clientId}`);
  const title = humanTitle(fileName);
  await getStore(cfg).insert(fileName, title, text);
  return {
    fileName,
    title,
    chars: text.length,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 600),
  };
}

// Cross-client portfolio query (Admin): the SAME real RAG pipeline is executed
// against every client's isolated store; results stay tagged per client.
export async function queryPortfolio(
  question: string
): Promise<PortfolioResult[]> {
  const results: PortfolioResult[] = [];
  for (const cfg of CLIENT_CONFIGS) {
    try {
      const result = await queryContracts(cfg.id, question);
      results.push({ clientId: cfg.id, clientName: cfg.name, result });
    } catch (err: any) {
      results.push({
        clientId: cfg.id,
        clientName: cfg.name,
        error: err?.message ?? "Query failed",
      });
    }
  }
  return results;
}
