import fs from "node:fs";
import path from "node:path";
import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { CLIENT_CONFIGS, getClientConfig, type ClientConfig } from "./clients";
import type { QueryResult, Source, PortfolioResult } from "./types";

// ---- Configuration ----
// Guardrail: if the best retrieved chunk scores below this, we refuse instead of guessing.
export const RELEVANCE_THRESHOLD = Number(process.env.RELEVANCE_THRESHOLD ?? "0.28");
export const TOP_K = Number(process.env.TOP_K ?? "5"); // chunks fed to the LLM after rerank
const CANDIDATE_K = Math.max(12, TOP_K * 3); // wider candidate set retrieved before rerank

// Lightweight hybrid reranker: semantic score + keyword overlap with the query.
// No external API — lifts the clause that literally matches the question
// (e.g. "auto-renew", "notice") even if its embedding score is slightly lower.
const RERANK_STOP = new Set(
  "the a an and or of to in for on at by with from that this these those is are was were be been being as it its their our your they them we you shall will may must can could would should not no any all each which who whose what when where how than then such other into out contract contracts agreement document documents clause".split(
    /\s+/
  )
);
function queryTerms(q: string): string[] {
  return (q.toLowerCase().match(/\d+(?:\.\d+)?|[a-z][a-z0-9/]*[a-z0-9]/g) || []).filter(
    (w) => w.length >= 3 && !RERANK_STOP.has(w)
  );
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

function humanTitle(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ");
}

let configured = false;
function configureSettings() {
  if (configured) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy .env.example to .env.local and add your key."
    );
  }
  Settings.llm = new OpenAI({
    apiKey,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    temperature: 0,
  });
  Settings.embedModel = new OpenAIEmbedding({
    apiKey,
    model: process.env.EMBED_MODEL ?? "text-embedding-3-small",
  });
  configured = true;
}

function loadDocuments(cfg: ClientConfig): Document[] {
  const files = fs
    .readdirSync(cfg.contractsDir)
    .filter((f) => f.toLowerCase().endsWith(".txt"));
  return files.map((file) => {
    const text = fs.readFileSync(path.join(cfg.contractsDir, file), "utf-8");
    return new Document({
      text,
      // clientId in metadata = tenant tag; isolation is additionally guaranteed by
      // building a fully separate index per client (see `indexes` below).
      metadata: { clientId: cfg.id, fileName: file, title: humanTitle(file) },
    });
  });
}

// One fully separate in-memory index per client (Map<clientId, index>).
// A query against client A physically cannot retrieve client B's chunks.
const indexes = new Map<string, Promise<VectorStoreIndex>>();

function getIndex(clientId: string): Promise<VectorStoreIndex> {
  const cfg = getClientConfig(clientId);
  if (!cfg) throw new Error(`Unknown client: ${clientId}`);
  let p = indexes.get(clientId);
  if (!p) {
    configureSettings();
    p = VectorStoreIndex.fromDocuments(loadDocuments(cfg));
    indexes.set(clientId, p);
  }
  return p;
}

export async function queryContracts(
  clientId: string,
  question: string
): Promise<QueryResult> {
  const index = await getIndex(clientId);

  // 1) Retrieve a wide candidate set — embed ONLY the question (no system prompt,
  //    so the query vector is not diluted). This alone fixes most "missed doc" cases.
  const retriever = index.asRetriever({ similarityTopK: CANDIDATE_K });
  const candidates = await retriever.retrieve(question);

  // 2) Hybrid rerank: semantic score + keyword overlap with the question.
  const terms = queryTerms(question);
  const topSemantic = candidates.reduce((m, n) => Math.max(m, n.score ?? 0), 0);
  const reranked = candidates
    .map((n) => {
      const text = String((n.node as any).text ?? "").toLowerCase();
      let hits = 0;
      for (const t of terms) if (text.includes(t)) hits++;
      const hybrid = (n.score ?? 0) + Math.min(0.25, hits * 0.05);
      return { n, hybrid };
    })
    .sort((a, b) => b.hybrid - a.hybrid)
    .slice(0, TOP_K)
    .map((x) => x.n);

  const sources: Source[] = reranked.map((n) => {
    const meta = (n.node.metadata ?? {}) as { title?: string; fileName?: string };
    const raw = (n.node as any).text ?? "";
    const snippet = String(raw).replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      file: meta.title ?? meta.fileName ?? "document",
      fileName: meta.fileName ?? "",
      score: Number((n.score ?? 0).toFixed(3)),
      snippet,
    };
  });

  // 3) Guardrail on the best SEMANTIC score across candidates (keyword hits alone
  //    should not force an answer when nothing is truly relevant).
  const topScore = Number(topSemantic.toFixed(3));
  const refused = topScore < RELEVANCE_THRESHOLD || reranked.length === 0;

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
    .map((n, i) => {
      const meta = (n.node.metadata ?? {}) as { title?: string };
      return `[${i + 1}] (${meta.title ?? "document"})\n${String((n.node as any).text ?? "")}`;
    })
    .join("\n\n");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Contract excerpts:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });
  const answer = (completion.choices[0]?.message?.content ?? "").trim();

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
// The recognized text is inserted into the client's existing in-memory index, so
// the very next query can retrieve it. We also keep the raw text so the document
// viewer can show an uploaded file that has no copy on disk.
export type IngestResult = {
  fileName: string;
  title: string;
  chars: number;
  preview: string;
};

const uploadedDocs = new Map<string, { title: string; text: string }>();
const uKey = (clientId: string, fileName: string) => `${clientId}::${fileName}`;

export function getUploadedDoc(clientId: string, fileName: string) {
  return uploadedDocs.get(uKey(clientId, fileName));
}

export async function ingestDocument(
  clientId: string,
  fileName: string,
  text: string
): Promise<IngestResult> {
  const cfg = getClientConfig(clientId);
  if (!cfg) throw new Error(`Unknown client: ${clientId}`);
  const title = humanTitle(fileName);
  const index = await getIndex(clientId);
  await index.insert(
    new Document({
      text,
      metadata: { clientId, fileName, title, uploaded: true },
    })
  );
  uploadedDocs.set(uKey(clientId, fileName), { title, text });
  return {
    fileName,
    title,
    chars: text.length,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 600),
  };
}

// Cross-client portfolio query (Admin): the SAME real RAG pipeline is executed
// against every client's isolated index; results stay tagged per client.
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
