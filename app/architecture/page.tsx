import Link from "next/link";
import type { Metadata } from "next";
import { GOLDEN_SET_SIZE } from "@/lib/seeds";
import {
  SystemDiagram,
  PipelineDiagram,
  IngestionDiagram,
  IsolationDiagram,
  ErdDiagram,
  StatusChart,
} from "./diagrams";

export const metadata: Metadata = {
  title: "Architecture — Contract Intelligence",
  description: "How the Contract Intelligence RAG demo is built: pipeline, tenant isolation, data model and stack.",
};

const SECTIONS = [
  { id: "overview", label: "System overview" },
  { id: "pipeline", label: "Ask pipeline" },
  { id: "ingestion", label: "Ingestion & OCR" },
  { id: "isolation", label: "Tenant isolation" },
  { id: "erd", label: "Data model / ERD" },
  { id: "quality", label: "Quality metrics" },
  { id: "stack", label: "Tech stack" },
];

const STACK: { group: string; items: [string, string][] }[] = [
  {
    group: "Frontend",
    items: [
      ["Framework", "Next.js 14.2 (App Router)"],
      ["UI", "React 18.3, plain CSS (no UI kit)"],
      ["Language", "TypeScript 5.5, strict"],
    ],
  },
  {
    group: "RAG core",
    items: [
      ["Orchestration", "LlamaIndex.TS 0.12"],
      ["LLM", "OpenAI gpt-4o-mini (temp 0)"],
      ["Embeddings", "OpenAI text-embedding-3-small"],
    ],
  },
  {
    group: "Ingestion",
    items: [
      ["PDF text layer", "unpdf"],
      ["Scan rasterize", "pdf-to-img (≤10 pages)"],
      ["Local OCR", "Tesseract.js 7 (on-prem option)"],
    ],
  },
  {
    group: "Data",
    items: [
      ["Confirmed facts", "JSON seed files (git)"],
      ["Contracts", "filesystem .txt"],
      ["Vectors", "in-memory index (no DB in v1)"],
    ],
  },
  {
    group: "Platform",
    items: [
      ["Hosting", "Vercel — Node.js serverless"],
      ["Compute", "Fluid Compute runtime"],
      ["Source / CI", "GitHub → Vercel auto-deploy"],
    ],
  },
  {
    group: "Auth (v1)",
    items: [
      ["Session", "Mock — role + name, cookie"],
      ["Roles", "Legal/Ops analyst · Partner/Admin"],
      ["Real auth", "planned — next iteration"],
    ],
  },
];

export default function ArchitecturePage() {
  return (
    <div>
      <header className="archtop">
        <span className="brandlogo" style={{ background: "#fff", color: "#1f3864" }}>
          CI
        </span>
        <span className="brandname">Contract Intelligence — Architecture</span>
        <Link href="/dashboard" className="archback">
          ← Back to the app
        </Link>
      </header>

      <div className="archwrap">
        <div className="archhero">
          <h1>How this was built</h1>
          <p className="lead">
            A real, working RAG pipeline over real contracts — not a mock. This page documents
            the system as it actually runs today: the request flow, the OCR/ingestion path,
            how client data stays isolated, the logical data model, and the current quality
            numbers. Everything below is drawn from the code in this repo, not aspirational.
          </p>
          <nav className="archtoc">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <section className="archsection" id="overview">
          <h2>
            <span className="archno">1</span>System overview
          </h2>
          <p className="archdesc">
            One Next.js app does double duty: the App Router serves the UI (client components +
            a small React-context store for the mock session), and its API routes run the RAG
            pipeline server-side on Vercel&apos;s Node.js runtime — not Edge, since the pipeline
            needs real Node APIs (<code>fs</code>, native OCR deps). <code>next.config.js</code>{" "}
            marks LlamaIndex/OpenAI/OCR packages as <code>serverComponentsExternalPackages</code>{" "}
            and ships <code>data/**/*</code> with each function via{" "}
            <code>outputFileTracingIncludes</code>, so the contract files are present at runtime.
          </p>
          <div className="diagramcard">
            <SystemDiagram />
          </div>
        </section>

        <section className="archsection" id="pipeline">
          <h2>
            <span className="archno">2</span>Ask pipeline (the real RAG)
          </h2>
          <p className="archdesc">
            <code>queryContracts()</code> in <code>lib/rag.ts</code>. Retrieval is wide on purpose
            (15 candidates) and then re-ranked with a lightweight hybrid score — pure semantic
            search alone missed clauses that use exact words like &ldquo;auto-renew&rdquo; but
            score slightly lower — before a hard guardrail decides whether the model is even
            allowed to answer.
          </p>
          <div className="diagramcard">
            <PipelineDiagram />
          </div>
          <div className="archnote">
            Guardrail threshold defaults per embedding model (0.28 OpenAI, 0.40 local) and is
            overridable with <code>RELEVANCE_THRESHOLD</code>, applied to the{" "}
            <em>best semantic score</em> across candidates — keyword hits alone never force an
            answer. If the model itself can&apos;t find the answer in context, that&apos;s also
            surfaced as a clean refusal, not a guess.
          </div>
        </section>

        <section className="archsection" id="ingestion">
          <h2>
            <span className="archno">3</span>Ingestion &amp; OCR
          </h2>
          <p className="archdesc">
            Upload runs through <code>lib/ocr.ts</code> then <code>lib/analyze.ts</code>. Text
            files skip OCR entirely; PDFs try their real text layer first (fast, free) and only
            rasterize + OCR pages that turn out to be scans; images always go through OCR. Two
            OCR engines are selectable per upload — OpenAI Vision for quality, or Tesseract.js
            for a fully local/on-prem path where nothing leaves the box.
          </p>
          <div className="diagramcard">
            <IngestionDiagram />
          </div>
          <div className="archnote">
            Risk flags are deterministic regex rules (auto-renewal, change-of-control, insurance,
            missing liability cap, governing law) — not an LLM call. Predictable and explainable
            for a demo; the recognized text is inserted straight into that client&apos;s live
            index, so the very next question can retrieve it.
          </div>
        </section>

        <section className="archsection" id="isolation">
          <h2>
            <span className="archno">4</span>Multi-tenant isolation
          </h2>
          <p className="archdesc">
            Each client gets its own <code>VectorStoreIndex</code>, held in a{" "}
            <code>Map&lt;clientId, index&gt;</code> and built lazily on first query. There is no
            shared vector store to accidentally query across — isolation is structural, not a
            filter that could be forgotten. The cross-client Portfolio view (Admin only) runs the
            identical pipeline once per client and tags results afterwards; it never merges
            indexes.
          </p>
          <div className="diagramcard">
            <IsolationDiagram />
          </div>
        </section>

        <section className="archsection" id="erd">
          <h2>
            <span className="archno">5</span>Data model / ERD
          </h2>
          <p className="archdesc">
            There is no database in v1 — by design, to keep the prototype simple. &ldquo;Confirmed
            facts&rdquo; (register, seed flags, deadlines, goldens) live in git-committed JSON per
            client; contracts are plain <code>.txt</code> files embedded into the in-memory index;
            everything else (session, tasks, audit log, the last query result) lives only in the
            browser tab&apos;s memory for that visit.
          </p>
          <div className="diagramcard">
            <ErdDiagram />
          </div>
          <div className="archlegend">
            <span>
              <i className="dot" style={{ background: "#1f3864" }} />
              server config
            </span>
            <span>
              <i className="dot" style={{ background: "#2e75b6" }} />
              JSON seed (git-committed)
            </span>
            <span>
              <i className="dot" style={{ background: "#8a93a6" }} />
              runtime only (browser memory, dashed border)
            </span>
          </div>
          <div className="relbox" style={{ marginTop: 16 }}>
            <div className="relrow">
              <b>ClientConfig ↔ ClientSeed</b>
              <span className="muted">1:1, joined by id = clientId — one is the server-side file path config, the other the client-safe display data.</span>
            </div>
            <div className="relrow">
              <b>ClientSeed → DocMeta / RegisterRow / Flag / Deadline / Golden</b>
              <span className="muted">1:* — all embedded arrays inside that client&apos;s seed.json.</span>
            </div>
            <div className="relrow">
              <b>Flag → TaskItem</b>
              <span className="muted">0..1 — confirming a flag creates a task (human-in-the-loop); lives only in browser memory.</span>
            </div>
            <div className="relrow">
              <b>Session → AuditEvent</b>
              <span className="muted">1:* — every sign-in, query, flag action and export appends an in-memory audit row.</span>
            </div>
            <div className="relrow">
              <b>ClientConfig → QueryResult</b>
              <span className="muted">ephemeral — every Ask/Portfolio call produces one, shown live in Inspector, never persisted.</span>
            </div>
          </div>
        </section>

        <section className="archsection" id="quality">
          <h2>
            <span className="archno">6</span>Quality metrics &amp; what&apos;s real vs mock
          </h2>
          <p className="archdesc">
            Quality is <b>measured on demand</b>, not asserted here. This page used to
            chart four invented constants; they have been removed, because a number
            nobody computed is worth less than no number. <b>Run evals</b> on the
            Inspector &amp; Evals screen puts the active client&apos;s golden questions
            through the real pipeline; <code>npm run evals</code> covers all{" "}
            {GOLDEN_SET_SIZE} across both clients.
          </p>
          <div className="archgrid2">
            <div className="diagramcard">
              <div className="klabel" style={{ marginBottom: 8 }}>
                What a run measures
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                <li>
                  <b>Refusal</b> — the off-topic probe must be refused, real questions
                  must be answered. <i>Exact.</i>
                </li>
                <li>
                  <b>Citation validity</b> — every cited snippet must be findable in the
                  document it names. <i>Exact.</i>
                </li>
                <li>
                  <b>Correct document</b> — the document the golden names must be among
                  the sources. <i>Exact.</i>
                </li>
                <li>
                  <b>Correctness</b> — does the answer state the expected facts?{" "}
                  <i>LLM judge.</i>
                </li>
                <li>
                  <b>Faithfulness</b> — is every claim supported by the retrieved
                  excerpts? <i>LLM judge.</i>
                </li>
              </ul>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Each run records the provider, models, vector store, chunker, TOP_K and
                guardrail threshold it ran under — a pass rate without them is not
                comparable to anything.
              </div>
            </div>
            <div className="diagramcard">
              <div className="klabel" style={{ marginBottom: 8 }}>
                Share of REAL vs MOCK vs SEED across the 10 product areas (README)
              </div>
              <StatusChart real={3} mock={4} seed={2} mixed={1} />
              <div className="archlegend">
                <span>
                  <i className="dot" style={{ background: "#185fa5" }} />
                  REAL — 3 (Ask/Q&amp;A, client isolation, Portfolio)
                </span>
                <span>
                  <i className="dot" style={{ background: "#98a2b3" }} />
                  MOCK — 4 (login, nav/dashboard, upload flow, audit log)
                </span>
                <span>
                  <i className="dot" style={{ background: "#a5670b" }} />
                  SEED — 2 (register, flags &amp; tasks)
                </span>
                <span>
                  <i className="dot" style={{ background: "#6b4fa0" }} />
                  MIXED — 1 (Evals: seed metrics + real last-query)
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="archsection" id="stack">
          <h2>
            <span className="archno">7</span>Tech stack
          </h2>
          <p className="archdesc">
            Deliberately small. No vector database, no auth provider, no UI kit — every piece was
            picked to make the RAG pipeline itself real and demoable fast, with the obvious gaps
            (persistent vector store, real auth, hybrid search reranking service) named up front
            in the README rather than faked.
          </p>
          {STACK.map((group) => (
            <div key={group.group} style={{ marginBottom: 14 }}>
              <div className="klabel">{group.group}</div>
              <div className="stackgrid">
                {group.items.map(([k, v]) => (
                  <div className="stackitem" key={k}>
                    <div className="k">{k}</div>
                    <div className="v">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="archfoot">
          Source: this repository (<code>README.md</code>, <code>REPORT.md</code>,{" "}
          <code>lib/rag.ts</code>, <code>lib/ocr.ts</code>, <code>lib/analyze.ts</code>,{" "}
          <code>lib/types.ts</code>). Generated as living documentation — update it when the
          pipeline changes.
        </div>
      </div>
    </div>
  );
}
