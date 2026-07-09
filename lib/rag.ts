import fs from "node:fs";
import path from "node:path";
import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";

// ---- Configuration ----
const CONTRACTS_DIR = path.join(process.cwd(), "data", "contracts");
// Guardrail: if the best retrieved chunk scores below this, we refuse instead of guessing.
const RELEVANCE_THRESHOLD = Number(process.env.RELEVANCE_THRESHOLD ?? "0.28");
const TOP_K = Number(process.env.TOP_K ?? "5");

// Grounded, no-hallucination system behaviour. We extract facts FROM the documents,
// we cite the source, and we refuse when the documents do not contain the answer.
const SYSTEM_PROMPT = `You are a contract analysis assistant for a specific client's document set.
Rules:
- Always respond in English.
- Answer ONLY using the provided contract excerpts. Never rely on outside knowledge of law.
- If the excerpts do not contain the answer, reply exactly: "Not found in the provided documents."
- Be concise. Quote the concrete value (amount, date, term, clause) and name the source document.
- You extract what the documents SAY. You do not give legal advice or interpret the law.`;

export type Source = {
  file: string;
  score: number;
  snippet: string;
};

export type QueryResult = {
  answer: string;
  refused: boolean;
  sources: Source[];
  topScore: number;
};

function humanTitle(fileName: string): string {
  return fileName
    .replace(/\.txt$/i, "")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ");
}

function configureSettings() {
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
}

function loadDocuments(): Document[] {
  const files = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".txt"));
  return files.map((file) => {
    const text = fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf-8");
    return new Document({
      text,
      metadata: { fileName: file, title: humanTitle(file) },
    });
  });
}

// Build the index once and cache it across requests (module-level singleton).
let indexPromise: Promise<VectorStoreIndex> | null = null;

async function getIndex(): Promise<VectorStoreIndex> {
  if (!indexPromise) {
    configureSettings();
    const documents = loadDocuments();
    indexPromise = VectorStoreIndex.fromDocuments(documents);
  }
  return indexPromise;
}

export async function queryContracts(question: string): Promise<QueryResult> {
  const index = await getIndex();
  const queryEngine = index.asQueryEngine({ similarityTopK: TOP_K });

  const response = await queryEngine.query({
    query: `${SYSTEM_PROMPT}\n\nQuestion: ${question}`,
  });

  const nodes = response.sourceNodes ?? [];
  const sources: Source[] = nodes.map((n) => {
    const meta = (n.node.metadata ?? {}) as { title?: string; fileName?: string };
    const raw = (n.node as any).text ?? "";
    const snippet = String(raw).replace(/\s+/g, " ").trim().slice(0, 240);
    return {
      file: meta.title ?? meta.fileName ?? "document",
      score: Number((n.score ?? 0).toFixed(3)),
      snippet,
    };
  });

  const topScore = sources.length ? sources[0].score : 0;
  const refused = topScore < RELEVANCE_THRESHOLD;

  return {
    answer: refused ? "Not found in the provided documents." : response.response.trim(),
    refused,
    sources,
    topScore,
  };
}
