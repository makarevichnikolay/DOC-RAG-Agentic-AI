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
| Evals against the golden sets | **REAL** — `Run evals` on `/evals`, or `npm run evals` |
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
lib/chunking.ts            clause-aware splitting + embedding-model size cap
lib/evals.ts               executable golden-set evals (deterministic + LLM judge)
app/api/evals/             POST { clientId, judge } -> a measured EvalRun
scripts/evals.mjs          CLI runner; exits non-zero on failure
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
different cosine-score distribution: `0.28` for OpenAI and `0.40` for local
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

## Chunking

Contracts are numbered clauses, not prose, so they are split on clause
boundaries (`2.2`, `9.16.3`, `ARTICLE 4`) rather than every N tokens. Oversized
clauses are subdivided — sub-clauses `(a)`/`(ii)`, then paragraphs, then
sentences — and thin fragments (table-of-contents lines, one-line definitions)
are merged back into their neighbours.

Measured on the bundled contracts:

| | SentenceSplitter | clause-aware (cap 1500) |
| --- | --- | --- |
| chunks (`data/contracts`) | 54 | 274 |
| median chunk | 4,725 chars | ~650 chars |
| largest chunk | 5,526 chars | 1,500 chars |
| **chunks over the local model's 512-token limit** | **53 of 54** | **0 of 274** |
| avg context sent to the model per question | 22,466 chars | ~4,300 chars |

That last-but-one row is the important one. Embedding models truncate silently:
a 4,680-char chunk tokenises to 1,002 tokens, and on `all-MiniLM-L6-v2` its
vector is identical (cosine `1.000000`) to the vector of just its first 512
tokens. The back half of almost every chunk was invisible to semantic search.
BM25 still indexed it, which is part of why hybrid retrieval helped so much.

Two invariants the splitter must keep:

1. **Every chunk is a verbatim, contiguous substring of its document.** The
   source viewer finds a chunk by searching the document for its snippet, so a
   chunk with a synthetic heading prefix would never be located and the citation
   highlight would silently disappear.
2. **No chunk exceeds `MAX_CHUNK_CHARS`** (see `.env.example`).

Both are asserted against every bundled contract, along with losslessness —
concatenating a document's chunks reproduces the document.

**Chunk overlap was tried and removed.** Carrying 200 characters of the next
clause into each chunk was worse on every measured axis (evidence coverage
61% → 56%, and it degraded guardrail separation). Duplicated text inflates BM25
document lengths and blurs the boundaries the split exists to sharpen. See the
comment in `lib/chunking.ts` before re-adding it.

**Neighbour expansion** (`lib/neighbours.ts`) closes the gap that clause
splitting opened. Clauses that used to share a chunk no longer do, and contracts
are full of clauses that only make sense beside their neighbour — clause 6.2
opens "Following the expiry of the 10 year period referred to in Article 6.1.
above", never says "warehouse" or "lease term", and ranks #62 of 274 while 6.1
ranks #1. So after retrieval, the top `NEIGHBOUR_TOP_N` hits also contribute the
chunk either side.

Measured on the 8 northwind goldens:

| | target clauses found | avg context |
| --- | --- | --- |
| widen the candidate pool 15 → 30 → 80 | 0 of 2 | ~3,800 chars |
| neighbours, topN=2 | 1 of 2 | 6,347 chars |
| **neighbours, topN=3 (default)** | **2 of 2** | **7,082 chars** |
| neighbours, topN=5 | 2 of 2 | 9,045 chars |
| whole parent section | 2 of 2 | 10,367 chars |

Searching harder does not work: at a pool of 80 both clauses are still missed,
because neither looks like the question. Parent sections work but have no size
ceiling — one section in `data/contracts` is 14,249 characters. Neighbours are
bounded by `MAX_CHUNK_CHARS`, so ±1 adds a predictable amount.

Neighbours appear in the Inspector as `neighbour of #N (not retrieved)`, with no
score, because retrieval genuinely did not find them.

## Evals

`/evals` has a **Run evals** button that puts every golden question through the
real pipeline. Before pressing it the page shows `—` in all four metric slots and
`not run` in every Status cell. Nothing is asserted that has not been measured.

The four invented constants that used to sit there (faithfulness 0.96, citation
accuracy 0.94, answer relevance 0.92, hallucination 0.008) are gone from both
`/evals` and the public `/architecture` page. Labelling them "seed" was not
enough: on pages whose subject is measured quality, a number nobody computed is
worth less than no number.

Also runnable from the terminal, exiting non-zero on any failure:

```bash
npm run dev                  # in one shell
npm run evals                # both clients
npm run evals -- --no-judge  # skip grading — halves the LLM calls, does not remove them
npm run evals -- --client=blue-harbor-retail
```

Five things are measured, and they differ in how much you should trust them:

| Check | How | Trust |
| --- | --- | --- |
| **Refusal** — is the off-topic probe refused, and are real questions answered? | exact | total |
| **Retrieval recall** — did the excerpts contain the expected answer's key facts? | exact | total |
| **Citation validity** — is each cited snippet findable in the document it names? | exact | total |
| **Correct document** — was the document the golden names among the sources? | exact | total |
| **Isolation** — does the client's store hold only that client's documents? | exact | total |
| **Correctness** — does the answer state the expected facts? | LLM judge | good, not perfect |
| **Faithfulness** — is every claim supported by the retrieved excerpts? | LLM judge | good, not perfect |

**Retrieval recall is the diagnostic that tells you which half broke.** RAG is
retrieval plus generation, and without this a failure reads as "the model wrote
a bad answer" even when the model never received the relevant clause — which was
true of *every* failure in the first real run. `retrieval MISS` means fix search;
`retrieval ok` next to a wrong answer means fix the prompt or the model.

Matching is deliberately tolerant of how contracts write numbers. The expected
answers say "60 days", "2 years", "3-year"; the contracts say "sixty (60) days",
"two years", "periods of 3 years". A literal comparison reported MISS on
questions that had retrieved the right clause and graded `correct` — a
diagnostic pointing at the wrong half is worse than none. It still refuses to
match a *different* number: "60 days" does not match "thirty (30) days".

Its known bias, which is why it labels rather than gates: coverage rises with the
amount of text retrieved, so a configuration that simply sends more would score
better without being better.

**Isolation** can be checked on its own — it reads stored data, asks no model and
embeds nothing, so it costs nothing:

```bash
npm run evals -- --isolation
```

Deterministic checks come first on principle: anything a substring comparison can
decide is decided that way, because it is free, instant and reproducible. The
judge is reserved for the one question that needs reading comprehension.

**What a run costs.** Two LLM calls per question — one to answer it, one to grade
it — so the full 14-question set across both clients is ~24 calls (the two
guardrail probes are refused before any answer is generated, so they cost
nothing). `--no-judge` skips the grading call, halving that to ~12; it does
**not** make the run free, because answering the question is itself a call.
Embeddings are free when `EMBED_PROVIDER=local`, since the model runs in-process.

The judge follows the usual guidance — discrete labels rather than a 1-10 score,
reasoning written before the verdict, and correctness graded separately from
faithfulness so a *lucky* hallucination (right answer, unsupported by the
excerpts) stays visible instead of being averaged away.

**Three caveats, stated rather than buried.** By default the judge is the same
model that wrote the answer, and models favour their own output — escape that
with `EVAL_JUDGE_PROVIDER` **and** `EVAL_JUDGE_MODEL` together, since changing
vendor is the point and the model id alone goes to whichever SDK `LLM_PROVIDER`
picked. The judge is also not deterministic: successive runs of the same set have
graded 3 vs 4 questions `correct`, so treat single-point movements as noise. And
when a judge call fails outright the question is reported as **ungraded** rather
than failed — it still passes its deterministic checks, so the summary counts
those separately to keep a judge outage from reading as a clean run.

Every run prints the configuration it ran under (provider, models, vector store,
chunker, `TOP_K`, threshold). A pass rate without that is not comparable to
anything.

## Survey questions

"Which contracts include insurance obligations?" needs one hit from *each*
contract, but retrieval returns the best five chunks overall — and the Master
Services Agreement carries pages of insurance schedules, so it filled every slot
and the Transportation MSA's cargo-insurance clause never reached the model.

Questions matching `SURVEY_QUESTION` in `lib/rag.ts` therefore regroup the same
candidate pool, capping each document at `SURVEY_PER_DOC` (default 2) chunks.
Nothing extra is retrieved. Measured on the golden set, retrieval recall goes
**7/8 to 8/8**.

Applying the same cap to *every* question was measured first and was worse
(evidence coverage 50% → 42%), which is why the question's shape decides. Three
other approaches to this failure were measured and rejected: a wider candidate
pool (15 → 80, no change), cross-encoder reranking (target fell to last place),
and contextual retrieval (rank 13 → 10, still outside the top 5).

## The relevance guardrail, honestly

Retrieval refuses to answer when the best semantic score falls below
`RELEVANCE_THRESHOLD`. Measured over 12 golden and 4 off-topic questions with
`EMBED_PROVIDER=local`, the two populations **overlap**:

```
lowest relevant score   0.448   "Which state's law governs the NDA…"
highest off-topic score 0.546   "What is the personal phone number of the CFO?"
```

No threshold separates them. The CFO question scores 0.546 because every
contract carries a notices clause full of names, addresses and phone numbers —
it genuinely is close to the documents in meaning.

The default is **0.40**, set deliberately. The measured optimum is 0.42:

| threshold | off-topic refused by score | goldens wrongly refused |
| --- | --- | --- |
| 0.42 | 3 of 4 | 0 of 12 |
| **0.40** (current) | **1 of 4** | 0 of 12 |

Two probes score 0.412 and 0.413, so they sit inside that 0.02 gap and the lower
value lets both through. They are still refused — by the model reading the
excerpts and finding nothing, rather than by the score — at the cost of one LLM
call each. Nothing relevant scores below 0.448, so 0.40 gains no coverage on the
answering side.

**The table above predates a change to the probe set and has not been re-measured.**
Northwind's guardrail probe used to be *"What is the home address of Northwind's
CEO?"*, scoring 0.413 — one of the two probes sitting in the 0.40–0.42 gap. That
probe was hollow: "Northwind" is the demo client's label and appears in no
contract, so it refused because the name matched nothing and would have passed
with any invented name. It is now *"What is the personal phone number of Bakken
Resources' CEO?"* — a company that **is** a party to Doc 4. Measured the same way,
it scores **0.457**, so the 0.42 row is no longer 3 of 4; the 0.40 row is
unchanged, since 0.457 clears both thresholds. Re-run the calibration before
quoting the 0.42 optimum again.

The replacement is a harder test in the way that matters. Its top hit is the
notices clause holding Val M. Holms' home address (0.457) — the model is handed a
block full of names, a P.O. box and a street address and asked for a phone number
that exists nowhere in the corpus. The companion golden *"What is the home address
of Bakken Resources' CEO?"* retrieves that same chunk at 0.458 and **must be
answered**: a notice address is contract data, not a leak. Two questions, one
chunk, one point apart — so retrieval cannot separate them and only the model's
grounding decides. That is precisely the line this section says actually holds.

Either way the score guardrail is a coarse first filter, and the model's grounded
refusal is what actually holds the line. Do not present the score as a guarantee.

This also corrected a stale number. The previous 0.32 was calibrated against a
single probe question and against the old 4,700-char chunks; under clause-aware
chunking it would have wrongly *allowed* 3 of the 4 off-topic questions. The
`openai` and `voyage` thresholds have **not** been re-measured since — see the
note in `lib/providers.ts`.

## Principles

Human-in-the-loop (system proposes, human confirms) · a citation on every answer ·
honest "Not found in the provided documents." · client isolation · facts from documents,
not legal advice.

## Next iterations (out of v1 scope)

Real user DB/auth, live ingestion of arbitrary uploads, persistent vector store
(pgvector/Qdrant), hybrid search + reranking, multi-tenant security hardening,
email notifications, mobile layout.
