# Contract Intelligence — full interactive prototype (Next.js + LlamaIndex.TS)

A Contract / Document Intelligence demo for law firms and document-heavy businesses:
**mock login with roles, a role-filtered app shell, and every scenario walkable end-to-end**,
with **real RAG** (retrieval, citations, guardrail, Inspector) over real/realistic contracts,
scoped per client (isolation).

Built to `docs/Prototype_requirements_v1.pdf`. English only.

## Real vs simulated

| Component | Status |
|---|---|
| Q&A: retrieval, citations, guardrail, Inspector | **REAL** — live RAG per client (`/ask`) |
| Client isolation (scoped retrieval) | **REAL** — separate in-memory index per client |
| Portfolio cross-client query (Admin) | **REAL** — same pipeline over every client's index (`/portfolio`) |
| Login & roles | MOCK — pick a role, no password (cookie session) |
| Menu/navigation, dashboard | MOCK — clickable, seed data |
| Document upload | MOCK — "processing" animation, pre-loaded file appears |
| Register of terms | SEED — human-confirmed facts per client |
| Flags & tasks | SEED + local state — Confirm creates a task; T-1 generates a placeholder doc |
| Evals panel | SEED metrics + REAL last-query chunks/scores |
| Audit log | MOCK — session memory (Settings) |

## Demo clients

- **Northwind Logistics** — 5 real public contracts (SEC EDGAR) in `data/contracts/`.
- **Blue Harbor Retail** — 3 realistic synthetic retail contracts in `data/blue-harbor-retail/contracts/`
  (EDGAR fetch was unavailable when they were assembled; see `_SOURCE_README.md` there).

## Roles (mock login)

- **Legal Analyst** — clients, documents, Ask, register, flags.
- **Operations / Procurement** — same, but register and evals are view-only; no portfolio/settings.
- **Partner / Admin** — everything + cross-client Portfolio + Evals + Settings.

"Switch role" is always available in the top bar.

## Run

```bash
npm install
cp .env.example .env.local      # add your OPENAI_API_KEY
npm run dev                      # http://localhost:3000
npm run build                    # must pass; the key is only needed for live queries
```

Models: `gpt-4o-mini` + `text-embedding-3-small` (cheap). The per-client index is built
on the first query for that client and cached in memory.

## Structure

```
app/login/                 mock login (role + demo name)
app/(app)/                 app shell: top bar, client selector, role-filtered sidebar
  dashboard/ clients/ documents/ documents/view/ ask/ register/
  flags/ portfolio/ evals/ settings/
app/api/query/             POST { question, clientId } → scoped RAG answer
app/api/portfolio/         POST { question } → per-client RAG answers (Admin)
app/api/document/          GET  ?clientId&file → contract text (viewer, path-guarded)
app/api/config/            GET  effective runtime params (Settings)
lib/rag.ts                 per-client indexes, retrieval + guardrail + citations
lib/clients.ts             tenant config (server) · lib/seeds.ts seed data (client)
data/contracts/            Northwind Logistics contracts (real, SEC EDGAR)
data/northwind-logistics/  seed.json + extra/ (upload-demo file)
data/blue-harbor-retail/   contracts/ + seed.json + extra/
```

## Settings (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `OPENAI_API_KEY` | — | required for live queries only |
| `LLM_MODEL` | gpt-4o-mini | answer model |
| `EMBED_MODEL` | text-embedding-3-small | embeddings |
| `TOP_K` | 5 | retrieved chunks |
| `RELEVANCE_THRESHOLD` | 0.28 | guardrail (below → refuse) |

## Principles

Human-in-the-loop (system proposes, human confirms) · a citation on every answer ·
honest "Not found in the provided documents." · client isolation · facts from documents,
not legal advice.

## Next iterations (out of v1 scope)

Real user DB/auth, live ingestion of arbitrary uploads, persistent vector store
(pgvector/Qdrant), hybrid search + reranking, multi-tenant security hardening,
email notifications, mobile layout.
