# REPORT — full interactive prototype build (overnight run, 2026-07-10)

## What was built

The single-screen RAG demo was extended into the **full clickable prototype** specified in
`docs/Prototype_requirements_v1.pdf`, using the HANDOFF.md defaults. Everything is English-only.

- **Mock login + roles** (`/login`): pick Legal Analyst / Operations / Admin + a demo name, no
  password. Session in a cookie; "Switch role" always available in the top bar.
- **App shell** (`app/(app)/layout.tsx`): top bar with product name, **client selector**
  (Northwind Logistics / Blue Harbor Retail), current user + role, Switch role; sidebar menu
  **filtered by role** per the access matrix (Portfolio & Settings admin-only; Register and
  Inspector & Evals view-only for Operations); route guards on restricted screens.
- **Dashboard** — role-aware stat cards (documents, open flags, open tasks, clients for admin),
  upcoming deadlines (seed), quick actions.
- **Clients** — set active client; all screens and retrieval are scoped to it.
- **Documents** — per-client list (seed); **simulated Upload** (processing animation → a
  pre-loaded amendment file appears, marked "not indexed"); **document viewer**
  (`/documents/view`) that serves the real text and **jumps to / highlights the cited fragment**.
- **Ask (REAL RAG)** — the original Q&A refactored and client-scoped: presets per client,
  live answer with **clickable citations** (open the doc at the fragment), the
  "Not found in the provided documents." **guardrail**, and the **Inspector** toggle
  (chunks + scores + threshold verdict).
- **Register** — seed human-confirmed terms per client; filter, column sort, **CSV export**
  (hidden for Operations = view-only).
- **Flags & Tasks** — seed flags; **Confirm → creates a Task** (human-in-the-loop, local state);
  Dismiss; task status select; **"Generate standard doc (T-1)"** produces a placeholder letter
  in a modal with .txt download.
- **Portfolio (REAL cross-client RAG, Admin)** — one question runs the same pipeline against
  **each client's isolated index**; per-client answer cards with clickable citations
  (switches active client and opens the doc).
- **Inspector & Evals** — pipeline strip (ingest → retrieve → rerank → generate → cite),
  **live** last-query chunks/scores, **seed** quality metrics (faithfulness 96%, citation
  accuracy 94%, relevance 92%, hallucination 0.8%) and the per-client golden-question table.
- **Settings (Admin)** — effective runtime params from `/api/config` (model, TOP_K, threshold,
  key-configured status), English-only reminder, sign-out, and the session **audit log** (mock,
  records sign-ins, queries, client switches, flag confirmations, exports, doc generation).
- **RAG core** (`lib/rag.ts`) — extended to a `Map<clientId, VectorStoreIndex>`: one fully
  separate in-memory index per client, so cross-client leakage is physically impossible;
  `queryContracts(clientId, q)` + `queryPortfolio(q)`; sources now carry `fileName` for the
  viewer. Guardrail/citations/prompt unchanged. Build does NOT require `OPENAI_API_KEY`
  (the key is checked only at query time).
- **APIs** — `/api/query` (client-scoped), `/api/portfolio`, `/api/document` (path-traversal
  guarded), `/api/config`.
- **Second client data** — `data/blue-harbor-retail/`: 3 contracts + amendment + `seed.json`
  (register, presets, flags, deadlines, goldens). Northwind got the same seed structure
  (`data/northwind-logistics/seed.json` + upload-demo amendment); its contracts stay in
  `data/contracts/` (kept in place — see decisions).

## Decisions made (defaults + judgment calls)

1. Product name **"Contract Intelligence"**, second client **"Blue Harbor Retail"**, **mock login** — per HANDOFF defaults.
2. **Blue Harbor contracts are SYNTHETIC** (realistic legalese, ~10–13 KB each): SEC EDGAR could
   not be fetched because the session's network/shell environment was down (see Blockers).
   Provenance is documented in `data/blue-harbor-retail/contracts/_SOURCE_README.md`. The
   fallback was explicitly allowed by the run instructions. Facts in the seed match the texts.
3. **"Switch role" visible for every role** (spec §3 says always available for demos), while the
   Settings *menu item* stays admin-only per the access matrix.
4. Northwind's contracts were **left in `data/contracts/`** (mapped via `lib/clients.ts`) instead
   of being moved: file deletion wasn't possible this session, and moving would have duplicated
   ~100 KB of contract text. `data/register.json` is now unused (superseded by per-client
   `seed.json`) and kept only for history.
5. "Renewals in the next 90 days?" portfolio preset was generalized to auto-renewal + notice
   phrasing, since answers must come from documents (the contracts state dates, not "days from
   today"); dashboards show the date-based deadlines seed instead.
6. Upload-demo files live in `data/<client>/extra/` — viewable via the document API but **not
   ingested**, so the "uploaded (demo) · not indexed" chip stays truthful.
7. Evals metrics are seeded constants (`lib/seeds.ts`), goldens per client come from the
   original golden set (translated to English) + 5 authored for Blue Harbor.

## Blocked / left (environment failure — not code)

The session's isolated Linux workspace **never booted** (rootfs checksum mismatch on every
attempt, including retries over several hours). Consequences:

- **`npm run build` could not be executed** — no shell existed. Mitigation: a full static
  review pass (imports, strict-TS, App Router rules — incl. `useSearchParams` in `<Suspense>`,
  client/server import graph, JSON-seed shape vs types, llamaindex 0.12.1 API) found
  **no blockers**. Please run `npm run build` after pulling; any residual error should be trivial.
- **`git commit` / `git push` could not be executed** (git needs the shell). All work is in the
  working tree, uncommitted. Staged-commit-per-stage was therefore impossible; suggested single
  commit below.
- **SEC EDGAR fetch unavailable** (web fetch rode on the same workspace) → synthetic Blue Harbor
  contracts (decision 2).

Nothing else is left: every spec screen/scenario is implemented.

## How to run / verify

```bash
npm install                     # deps unchanged — lockfile untouched, no new packages
npm run build                   # should pass without OPENAI_API_KEY
cp .env.example .env.local      # add OPENAI_API_KEY for live Q&A (may already exist)
npm run dev                     # http://localhost:3000
```

Walkthrough: login as each role → check menu differences → Documents: Upload (simulated) and
open a doc → Ask: run presets incl. the guardrail probe, click a citation (jumps to the
fragment), toggle Inspector → Register: filter/sort/CSV → Flags: Confirm → task → Generate T-1 →
switch client in the top bar and re-ask (isolation) → as Admin: Portfolio preset
("change of control") returns hits from BOTH clients with citations → Evals shows the live last
query + seed metrics → Settings shows params + audit log.

Commit when satisfied:

```bash
git add -A
git commit -m "Full interactive prototype: mock login+roles, app shell, per-client RAG, all scenario screens"
git push
```
