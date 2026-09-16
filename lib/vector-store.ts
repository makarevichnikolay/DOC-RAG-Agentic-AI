// Vector store backends, selected by VECTOR_STORE:
//
//   memory   (default) — LlamaIndex VectorStoreIndex, in RAM, rebuilt on restart.
//   postgres           — PostgreSQL + pgvector, persisted, shared across instances.
//
// Both satisfy the same ClientStore interface, so lib/rag.ts is identical either
// way: retrieve candidates -> rerank -> guardrail -> generate.
//
// Client isolation is preserved in BOTH backends. The memory backend keeps one
// index per client in a Map; the Postgres backend keeps one table per client.
// In neither case can a query for client A reach client B's chunks — there is no
// shared collection, so there is no WHERE clause that can be forgotten. For a
// legal product that guarantee is worth more than the tidier single-table schema.

import fs from "node:fs";
import path from "node:path";
import { TextNode, VectorStoreIndex } from "llamaindex";
import { CHUNKER_VERSION, maxChunkChars, splitDocument } from "./chunking";
import {
  configureEmbeddings,
  embedModelName,
  embedProvider,
  embedQuery,
  embedTexts,
} from "./providers";
import type { ClientConfig } from "./clients";

export type StoredChunk = {
  text: string;
  fileName: string;
  title: string;
};

export type ScoredChunk = StoredChunk & {
  /** Cosine similarity, 0..1. Higher is more relevant. */
  score: number;
};

export interface ClientStore {
  /** Top-k nearest chunks for this client, by cosine similarity. */
  retrieve(question: string, k: number): Promise<ScoredChunk[]>;
  /**
   * Every chunk held for this client, for the shared BM25 lexical index.
   * Both backends must return the SAME chunks they embedded, or the two halves
   * of hybrid search would be searching different text.
   */
  allChunks(): Promise<StoredChunk[]>;
  /** Add an uploaded document so the very next query can retrieve it. */
  insert(fileName: string, title: string, text: string): Promise<void>;
  /** Full text of an uploaded document, for the viewer (null if not uploaded). */
  getUploaded(fileName: string): Promise<{ title: string; text: string } | null>;
}

export function vectorStoreKind(): "memory" | "postgres" {
  // `||` not `??`: VECTOR_STORE= (present but blank) is common in .env files and
  // should mean "default", not "".
  const value = (process.env.VECTOR_STORE?.trim() || "memory").toLowerCase();
  if (value !== "memory" && value !== "postgres") {
    throw new Error(
      `VECTOR_STORE="${process.env.VECTOR_STORE}" is not supported. Use one of: memory | postgres.`
    );
  }
  return value;
}

export function humanTitle(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ");
}

/** The .txt contracts on disk for a client, with a change-detection fingerprint. */
function readContracts(cfg: ClientConfig): {
  docs: { fileName: string; title: string; text: string }[];
  fingerprint: string;
} {
  const files = fs
    .readdirSync(cfg.contractsDir)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort();

  const docs = files.map((fileName) => ({
    fileName,
    title: humanTitle(fileName),
    text: fs.readFileSync(path.join(cfg.contractsDir, fileName), "utf-8"),
  }));

  const stamp = files
    .map((f) => {
      const s = fs.statSync(path.join(cfg.contractsDir, f));
      return `${f}:${s.size}:${Math.round(s.mtimeMs)}`;
    })
    .join("|");

  return {
    docs,
    // The chunker is part of the fingerprint: changing how documents are split
    // changes what is stored, so an existing Postgres index must be rebuilt.
    fingerprint: `${embedProvider()}:${embedModelName()}:${CHUNKER_VERSION}:${maxChunkChars()}::${stamp}`,
  };
}

// =====================================================================
// Backend 1 — in-memory (LlamaIndex). The original behaviour, unchanged.
// =====================================================================

class MemoryStore implements ClientStore {
  private cfg: ClientConfig;
  private index: Promise<VectorStoreIndex>;
  private uploaded = new Map<string, { title: string; text: string }>();
  /**
   * The chunks this store embedded. Held explicitly because hybrid retrieval
   * needs BM25 to index exactly the text that was embedded — see build().
   */
  private chunks: StoredChunk[] = [];

  constructor(cfg: ClientConfig) {
    this.cfg = cfg;
    this.index = this.build();
    // The promise is awaited by every public method, but `getUploaded` can be
    // reached before any of them; swallow here so a failed build can never
    // surface as an unhandled rejection and kill the process.
    this.index.catch(() => {});
  }

  private async build(): Promise<VectorStoreIndex> {
    await configureEmbeddings();
    // Split HERE rather than letting fromDocuments do it. fromDocuments applies
    // its own splitter, so its chunk boundaries differ from ours. That mismatch
    // made every lexical hit look like a different chunk from the semantic hit
    // covering the same text, so RRF could never reinforce a chunk found by
    // both retrievers. Owning the split keeps the two halves aligned.
    this.chunks = this.split(readContracts(this.cfg).docs);
    return VectorStoreIndex.init({ nodes: this.chunks.map((c) => this.toNode(c)) });
  }

  private split(docs: { fileName: string; title: string; text: string }[]): StoredChunk[] {
    const out: StoredChunk[] = [];
    for (const d of docs) {
      for (const piece of splitDocument(d.text)) {
        out.push({ text: piece, fileName: d.fileName, title: d.title });
      }
    }
    return out;
  }

  private toNode(chunk: StoredChunk): TextNode {
    return new TextNode({
      text: chunk.text,
      metadata: { clientId: this.cfg.id, fileName: chunk.fileName, title: chunk.title },
    });
  }

  async retrieve(question: string, k: number): Promise<ScoredChunk[]> {
    const index = await this.index;
    const nodes = await index.asRetriever({ similarityTopK: k }).retrieve(question);
    return nodes.map((n) => {
      const meta = (n.node.metadata ?? {}) as { title?: string; fileName?: string };
      return {
        text: String((n.node as { text?: string }).text ?? ""),
        fileName: meta.fileName ?? "",
        title: meta.title ?? meta.fileName ?? "document",
        score: n.score ?? 0,
      };
    });
  }

  async insert(fileName: string, title: string, text: string): Promise<void> {
    const index = await this.index;
    const added = this.split([{ fileName, title, text }]);
    await index.insertNodes(added.map((c) => this.toNode(c)));
    this.chunks.push(...added); // keep the lexical index in step with the vectors
    this.uploaded.set(fileName, { title, text });
  }

  async allChunks(): Promise<StoredChunk[]> {
    await this.index; // built in the constructor; ensure it finished
    return this.chunks;
  }

  async getUploaded(fileName: string) {
    await this.index; // #5: never return before the build settles
    return this.uploaded.get(fileName) ?? null;
  }
}

// =====================================================================
// Backend 2 — PostgreSQL + pgvector.
// =====================================================================

type PgPool = import("pg").Pool;

let pool: PgPool | null = null;

export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "VECTOR_STORE=postgres requires DATABASE_URL (or POSTGRES_URL), e.g. " +
        "postgres://user:pass@localhost:5432/contract_intel"
    );
  }
  return url;
}

function getPool(): PgPool {
  if (pool) return pool;
  // Required at call time only, so `npm run build` never needs a database.
  const { Pool } = require("pg") as typeof import("pg");
  pool = new Pool({
    connectionString: connectionString(),
    max: Number(process.env.PG_POOL_MAX ?? "5"),
    // Managed Postgres (Neon, Supabase, RDS) generally requires TLS; a plain
    // local container does not. PGSSL=require opts in.
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

/** One table per client — the isolation boundary. */
function tableName(clientId: string): string {
  return `chunks_${clientId.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

const EMBED_BATCH = 64;

class PostgresStore implements ClientStore {
  private cfg: ClientConfig;
  private ready: Promise<void>;

  constructor(cfg: ClientConfig) {
    this.cfg = cfg;
    this.ready = this.sync();
  }

  /** Re-embed only when the contracts or the embedding model changed. */
  private async sync(): Promise<void> {
    const db = getPool();
    const table = tableName(this.cfg.id);
    const { docs, fingerprint } = readContracts(this.cfg);

    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await db.query(`
      CREATE TABLE IF NOT EXISTS store_meta (
        key   text PRIMARY KEY,
        value text NOT NULL
      )`);
    // Uploaded documents are kept whole (not just chunked) so a re-index after a
    // model change can re-embed them, and so the viewer can show a file that has
    // no copy on disk.
    await db.query(`
      CREATE TABLE IF NOT EXISTS uploaded_docs (
        client_id text NOT NULL,
        file_name text NOT NULL,
        title     text NOT NULL,
        text      text NOT NULL,
        PRIMARY KEY (client_id, file_name)
      )`);

    const stored = await db.query<{ value: string }>(
      "SELECT value FROM store_meta WHERE key = $1",
      [`fingerprint:${this.cfg.id}`]
    );
    const exists = await db.query<{ n: string }>("SELECT to_regclass($1) IS NOT NULL AS n", [
      `public.${table}`,
    ]);

    if (stored.rows[0]?.value === fingerprint && exists.rows[0]?.n) return; // already indexed

    const previouslyUploaded = await db.query<{ file_name: string; title: string; text: string }>(
      "SELECT file_name, title, text FROM uploaded_docs WHERE client_id = $1",
      [this.cfg.id]
    );

    await db.query(`DROP TABLE IF EXISTS ${table}`);

    const all = [
      ...docs,
      ...previouslyUploaded.rows.map((u) => ({
        fileName: u.file_name,
        title: u.title,
        text: u.text,
      })),
    ];
    for (const doc of all) {
      await this.writeDocument(doc.fileName, doc.title, doc.text);
    }

    await db.query(
      `INSERT INTO store_meta(key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`fingerprint:${this.cfg.id}`, fingerprint]
    );
  }

  /** Split, embed and store one document. Creates the table on first use. */
  private async writeDocument(fileName: string, title: string, text: string): Promise<void> {
    const db = getPool();
    const table = tableName(this.cfg.id);

    // Same splitter the in-memory backend uses, so chunking is identical.
    const pieces = splitDocument(text);
    if (pieces.length === 0) return;

    for (let offset = 0; offset < pieces.length; offset += EMBED_BATCH) {
      const batch = pieces.slice(offset, offset + EMBED_BATCH);
      const vectors = await embedTexts(batch);

      // pgvector needs a fixed dimension in the column type. Read it off the
      // first vector rather than hardcoding per-model numbers.
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id        bigserial PRIMARY KEY,
          file_name text NOT NULL,
          title     text NOT NULL,
          text      text NOT NULL,
          embedding vector(${vectors[0].length}) NOT NULL
        )`);

      const { toSql } = await import("pgvector");
      const values: string[] = [];
      const params: unknown[] = [];
      batch.forEach((piece, i) => {
        const b = i * 4;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
        params.push(fileName, title, piece, toSql(vectors[i]));
      });
      await db.query(
        `INSERT INTO ${table}(file_name, title, text, embedding) VALUES ${values.join(", ")}`,
        params
      );
    }

    // HNSW index for cosine distance. Built after load so it indexes real data;
    // on this corpus it is not needed for speed, but it is what makes the same
    // schema hold up at production document counts.
    await db.query(
      `CREATE INDEX IF NOT EXISTS ${table}_embedding_idx
         ON ${table} USING hnsw (embedding vector_cosine_ops)`
    );
  }

  async retrieve(question: string, k: number): Promise<ScoredChunk[]> {
    await this.ready;
    const db = getPool();
    const table = tableName(this.cfg.id);

    const exists = await db.query<{ n: boolean }>("SELECT to_regclass($1) IS NOT NULL AS n", [
      `public.${table}`,
    ]);
    if (!exists.rows[0]?.n) return [];

    const { toSql } = await import("pgvector");
    const vector = await embedQuery(question);

    // `<=>` is pgvector's cosine DISTANCE; the rest of the pipeline speaks
    // similarity, so convert here and nowhere else.
    const { rows } = await db.query<{
      text: string;
      file_name: string;
      title: string;
      score: number;
    }>(
      `SELECT text, file_name, title, 1 - (embedding <=> $1) AS score
         FROM ${table}
        ORDER BY embedding <=> $1
        LIMIT $2`,
      [toSql(vector), k]
    );

    return rows.map((r) => ({
      text: r.text,
      fileName: r.file_name,
      title: r.title,
      score: Number(r.score),
    }));
  }

  async insert(fileName: string, title: string, text: string): Promise<void> {
    await this.ready;
    const db = getPool();

    await db.query(
      `INSERT INTO uploaded_docs(client_id, file_name, title, text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, file_name) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text`,
      [this.cfg.id, fileName, title, text]
    );
    // The chunk table only exists once something has been written; a client
    // whose contracts folder is empty reaches its first upload without one.
    const table = tableName(this.cfg.id);
    const exists = await db.query<{ n: boolean }>("SELECT to_regclass($1) IS NOT NULL AS n", [
      `public.${table}`,
    ]);
    if (exists.rows[0]?.n) {
      await db.query(`DELETE FROM ${table} WHERE file_name = $1`, [fileName]);
    }
    await this.writeDocument(fileName, title, text);
  }

  async allChunks(): Promise<StoredChunk[]> {
    await this.ready;
    const table = tableName(this.cfg.id);
    const exists = await getPool().query<{ n: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS n",
      [`public.${table}`]
    );
    if (!exists.rows[0]?.n) return [];
    const { rows } = await getPool().query<{ text: string; file_name: string; title: string }>(
      `SELECT text, file_name, title FROM ${table} ORDER BY id`
    );
    return rows.map((r) => ({ text: r.text, fileName: r.file_name, title: r.title }));
  }

  async getUploaded(fileName: string) {
    await this.ready;
    const { rows } = await getPool().query<{ title: string; text: string }>(
      "SELECT title, text FROM uploaded_docs WHERE client_id = $1 AND file_name = $2",
      [this.cfg.id, fileName]
    );
    return rows[0] ?? null;
  }
}

// =====================================================================

const stores = new Map<string, ClientStore>();

export function getStore(cfg: ClientConfig): ClientStore {
  const key = `${vectorStoreKind()}::${cfg.id}`;
  let store = stores.get(key);
  if (!store) {
    store = vectorStoreKind() === "postgres" ? new PostgresStore(cfg) : new MemoryStore(cfg);
    stores.set(key, store);
  }
  return store;
}
