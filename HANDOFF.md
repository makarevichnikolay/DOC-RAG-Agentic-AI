# HANDOFF — brief for the next Claude (build the full prototype)

> **CHANGELOG (2026-07-10):** Done — the full interactive prototype was built to
> `docs/Prototype_requirements_v1.pdf`: mock login + 3 roles, app shell with role-filtered
> menu, Dashboard, Clients, Documents (+simulated upload, viewer with citation jump),
> Ask (real per-client RAG), Register (filter/sort/CSV), Flags→Confirm→Task (+T-1 placeholder),
> Portfolio (real cross-client RAG, Admin), Inspector & Evals, Settings (+audit log).
> Second client "Blue Harbor Retail" uses realistic synthetic contracts (EDGAR was
> unreachable from the build environment). See REPORT.md for decisions and verification status.

You are picking up a project mid-way. This repo is self-contained; read this file first,
then `docs/Prototype_requirements_v1.pdf`. There is no prior chat context — everything you need is here.

## Context
- Company: Onix-Systems (software outsourcing). They are choosing a specialization around
  RAG / AI agents and building a flagship demo: **Contract / Document Intelligence** for
  law firms and document-heavy businesses.
- This repo already contains a **working single-screen RAG demo** (English) over 5 real
  contracts, on **Next.js + LlamaIndex.TS**. It builds and runs.

## Your task
Extend the current demo into the **full interactive prototype** described in
`docs/Prototype_requirements_v1.pdf` (role selection + mock login, app shell with menu,
and walk-through of every scenario). Build strictly to that spec.

## Confirmed decisions (defaults — proceed unless the user says otherwise)
1. Product name: **Contract Intelligence**.
2. Second demo client: **Blue Harbor Retail** (retail) — assemble ~3 real public contracts
   from SEC EDGAR (vendor agreement, lease, NDA) the same way as the first client. Keep them
   in `data/blue-harbor-retail/contracts/`.
3. Auth: **mock login** (pick a role, no password). No real user DB in v1.

## Hard constraints
- **English only** — all UI, RAG prompts, seed data, answers.
- **Keep the RAG real** (retrieval, citations, guardrail, Inspector). Everything else
  (login, menu, upload, tasks, evals metrics) may be simulated/seeded — see the real-vs-simulated
  table in the requirements.
- **Client isolation**: retrieval and all data must be scoped per client (namespace / metadata filter).
- Do not break the existing working demo; refactor it into the Ask/Q&A screen.

## Current state (what already works)
- `lib/rag.ts` — ingest `data/contracts/*.txt` → embeddings → in-memory VectorStoreIndex;
  retrieval with citations + relevance-threshold guardrail. (Extend to per-client indexes.)
- `app/api/query/route.ts` — POST { question } → { answer, refused, sources, topScore }.
- `app/page.tsx` — the single Q&A screen (register table, ask + presets, citations, Inspector, flags).
- `data/contracts/` — 5 real contracts (Northwind Logistics); `data/register.json` — seed register + flags + presets.
- Stack pinned in `package.json`: next 14.2.5, react 18.3.1, llamaindex 0.12.1, @llamaindex/openai 0.4.23.

## How to run / verify
```bash
npm install
cp .env.example .env.local      # add OPENAI_API_KEY
npm run dev                      # http://localhost:3000
npm run build                    # must pass with no type errors before you hand back
```
Models: gpt-4o-mini + text-embedding-3-small (cheap). Node 18+ (20 recommended).

## Design references (in /docs)
- `Prototype_requirements_v1.pdf` — **the spec to build** (roles, menu, screens, scenarios, acceptance criteria, build order).
- `User_flows_demo.pdf` — the 5 user flows in detail.
- `Concept_AI_contracts_for_lawyers.pdf` — product concept + agentic-RAG architecture + adjacent verticals.
- `Contract_Intelligence_pilot_TZ.pdf` — data model, accuracy strategy (recall/precision, "search vs full-scan"), confidentiality options.
- `data/contracts/_SOURCE_README.md` — the demo contract set + golden test questions (use for evals).

## Definition of done (from the spec)
Each role logs in and sees a role-filtered menu; every scenario is walkable end-to-end;
Q&A works live (RAG) scoped to the selected client with citations + guardrail; switching client
changes context with no cross-client leakage; Flags → Confirm → Task works; Admin runs a
cross-client Portfolio query; Inspector shows chunks+scores; Evals shows metrics; English throughout;
`npm run build` passes.

## How to return the result
Commit your work and push to this repo (same remote/branch the user set up). The user will
`git pull` on the original machine. Keep `node_modules`, `.next`, `.env.local` out of git
(already in `.gitignore`). Add a short note of what changed to the top of this file or a CHANGELOG.
