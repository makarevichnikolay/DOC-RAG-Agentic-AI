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
  score: number;
  snippet: string;
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
