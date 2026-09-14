// Shared types for the Contract Intelligence prototype.
// Keep this file free of runtime imports — it is used by both server and client code.

export type Role = "analyst" | "operations" | "admin";

export type Session = {
  role: Role;
  name: string;
};

export type Source = {
  file: string; // human title
  fileName: string; // actual file name on disk (for the document viewer)
  /**
   * Cosine similarity, or null when only BM25 found this chunk — a lexical-only
   * hit has no semantic score, and showing 0 would read as "no confidence"
   * for a chunk that was good enough to send to the model.
   */
  score: number | null;
  snippet: string; // first 240 chars of the retrieved chunk, whitespace-collapsed
  /**
   * Length of the WHOLE retrieved chunk, in RAW characters (not whitespace-
   * collapsed). The viewer adds it to a raw offset in the document, so a
   * collapsed length would cut the highlight window short.
   */
  chunkChars: number;
  /** Which half of hybrid retrieval surfaced this chunk. */
  via: "semantic" | "lexical" | "both";
  /** 1-based rank in each retriever's own list; null when it did not find it. */
  semanticRank: number | null;
  lexicalRank: number | null;
  /** Fused score: Σ 1 / (k + rank_i). */
  rrf: number;
};

export type QueryResult = {
  answer: string;
  refused: boolean;
  sources: Source[];
  topScore: number;
};

export type PortfolioResult = {
  clientId: string;
  clientName: string;
  result?: QueryResult;
  error?: string;
};

export type RegisterRow = {
  doc: string;
  term: string;
  law: string;
  parties: string;
  key: string;
};

export type FlagLevel = "warn" | "danger" | "info";

export type Flag = {
  id: string;
  level: FlagLevel;
  doc: string;
  text: string;
  cite: string;
};

export type TaskStatus = "open" | "in_progress" | "done";

export type TaskItem = {
  id: string;
  clientId: string;
  title: string;
  source: string; // "Doc name [cite]"
  status: TaskStatus;
  createdAt: string;
  docGenerated?: boolean;
};

export type DocMeta = {
  file: string;
  title: string;
  type: string;
  parties: string;
  date: string;
  law: string;
};

export type Deadline = {
  date: string;
  doc: string;
  text: string;
};

export type Golden = {
  q: string;
  expected: string;
  source: string;
};

export type AuditEvent = {
  time: string;
  user: string;
  role: string;
  action: string;
  detail: string;
};

export type ClientSeed = {
  clientId: string;
  client: string;
  industry: string;
  documents: DocMeta[];
  register: RegisterRow[];
  presets: string[];
  flags: Flag[];
  deadlines: Deadline[];
  uploadCandidate: DocMeta;
  goldens: Golden[];
};
