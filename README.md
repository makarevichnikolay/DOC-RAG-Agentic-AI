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
lib/rag.ts                 retrieval + hybrid rerank + guardrail + citations
lib/providers.ts           LLM / embedding provider selection (OpenAI · Anthropic · Voyage)
lib/vector-store.ts        vector store backends (in-memory · Postgres + pgvector)
lib/clients.ts             tenant config (server) · lib/seeds.ts seed data (client)
data/contracts/            Northwind Logistics contracts (real, SEC EDGAR)
data/northwind-logistics/  seed.json + extra/ (upload-demo file)
data/blue-harbor-retail/   contracts/ + seed.json + extra/
```

## Settings (env)

Three independent switches. Defaults reproduce the original behaviour, so an
existing `.env.local` keeps working. See `.env.example` for the full list.

| Var | Values | Default | Meaning |
|-----|--------|---------|---------|
| `LLM_PROVIDER` | `openai` \| `anthropic` | `openai` | Who writes the answer + does cloud OCR |
| `EMBED_PROVIDER` | `openai` \| `voyage` \| `local` | `openai` | Who turns text into vectors |
| `VECTOR_STORE` | `memory` \| `postgres` | `memory` | Where those vectors live |

A vector store is **not** an embedding provider, and Anthropic has no embeddings
API — so `LLM_PROVIDER=anthropic` still needs `EMBED_PROVIDER` underneath it.

| Var | Default | Meaning |
|-----|---------|---------|
| `OPENAI_API_KEY` | — | needed if either provider is `openai` |
| `ANTHROPIC_API_KEY` | — | needed if `LLM_PROVIDER=anthropic` |
| `VOYAGE_API_KEY` | — | needed if `EMBED_PROVIDER=voyage` |
| `LLM_MODEL` | gpt-4o-mini | OpenAI answer model |
| `ANTHROPIC_MODEL` | claude-opus-5 | Claude answer model |
| `ANTHROPIC_EFFORT` | unset | Claude reasoning depth (`low`…`max`); **not supported on Haiku 4.5** |
| `EMBED_MODEL` | text-embedding-3-small | OpenAI embeddings |
| `VOYAGE_MODEL` | voyage-3.5 | Voyage embeddings |
| `LOCAL_EMBED_MODEL` | Xenova/all-MiniLM-L6-v2 | local model, no key |
| `DATABASE_URL` | — | Postgres connection string (pgvector) |
| `TOP_K` | 5 | retrieved chunks |
| `RELEVANCE_THRESHOLD` | per model | guardrail (below → refuse) |

Current Claude models reject `temperature`/`top_p`, so the Anthropic path does
not send them.

`RELEVANCE_THRESHOLD` defaults **per embedding model**, because each produces a
different cosine-score distribution: `0.28` for OpenAI and `0.32` for local
(both measured on `data/contracts`); Voyage falls back to `0.28` but is
unverified. The
off-topic demo question sits close to the line, so a threshold borrowed from a
different model can make the guardrail answer instead of refuse — re-check it
with the Inspector panel after switching. Setting the env var overrides.

### Local embeddings (no API key)

`EMBED_PROVIDER=local` runs a small model in-process via Transformers.js — no
key, no network after the one-time ~90 MB weight download. Paired with the
Tesseract OCR engine, the only thing that leaves the machine is the final
question plus the retrieved excerpts. Retrieval quality is below OpenAI/Voyage;
it is the on-prem option, not the best one.

`@huggingface/transformers` is declared as an optional peer dependency, but npm
installs it anyway because `@llamaindex/env` also declares it as a `peerOptional`
— so it works out of the box, at the cost of ~680 MB of `node_modules`
(onnxruntime ships prebuilt binaries).

> **Do not add `omit=optional` to `.npmrc` to shrink that.** It also skips
> `@next/swc-*`, which are optional dependencies of Next.js, and the build then
> fails with `Failed to load SWC binary`. A full `npm ci` is ~1.8 GB; the
> deployed serverless functions are ~51 MB, because Next only traces what is
> actually imported and the local-embeddings path is loaded dynamically.

### Vector store

`memory` keeps one LlamaIndex index per client in RAM; everything is re-embedded
on the first query after each restart. `postgres` stores vectors in PostgreSQL
via `pgvector` — one `chunks_<client_id>` table per client, each with its own
HNSW cosine index — and re-embeds a client only when its contracts change or the
embedding model changes. Uploaded documents survive a restart under `postgres`,
not under `memory`.

Client isolation holds in both: separate index per client in memory, separate
table per client in Postgres. There is no shared collection, so there is no
`WHERE client_id = ?` that can be forgotten.

#### Postgres setup — the pgvector extension is required

`VECTOR_STORE=postgres` needs the **pgvector** extension. It does not ship with
PostgreSQL; without it the first query fails with
`extension "vector" is not available`.

**Option 1 — Docker (nothing to install on the host):**

```bash
docker run -d --name pgvector -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 pgvector/pgvector:pg16
```

The image has the extension built in; the app creates it on first use.

**Option 2 — an existing PostgreSQL server.** Install the package matching your
server's major version (`psql -V` to check), then enable it in the database named
in `DATABASE_URL`:

```bash
# Debian / Ubuntu — replace 17 with your major version
sudo apt install postgresql-17-pgvector

# macOS (Homebrew)
brew install pgvector

# then, once per database:
psql -U postgres -d your_database -c "CREATE EXTENSION vector;"
```

No restart is needed. Verify with:

```bash
psql -U postgres -d your_database -c \
  "SELECT extversion FROM pg_extension WHERE extname='vector';"
```

The app also runs `CREATE EXTENSION IF NOT EXISTS vector` itself, so the manual
`CREATE EXTENSION` is only needed when the app's database role lacks permission
to create extensions — which is the normal case on managed Postgres (Neon,
Supabase, RDS). Those also generally require `PGSSL=require`.

## Principles

Human-in-the-loop (system proposes, human confirms) · a citation on every answer ·
honest "Not found in the provided documents." · client isolation · facts from documents,
not legal advice.

## Next iterations (out of v1 scope)

Real user DB/auth, live ingestion of arbitrary uploads, persistent vector store
(pgvector/Qdrant), hybrid search + reranking, multi-tenant security hardening,
email notifications, mobile layout.
