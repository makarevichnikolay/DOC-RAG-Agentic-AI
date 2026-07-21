"use client";

import Link from "next/link";
import { EVAL_METRICS, getSeed } from "@/lib/seeds";
import { isViewOnly } from "@/lib/access";
import { useApp } from "../../providers";

const PIPELINE = ["ingest", "retrieve", "rerank", "generate", "cite"];

// Inspector & Evals: the pipeline strip, live retrieved chunks + scores from
// the most recent Ask query (REAL), and quality metrics on the golden set (SEED).
export default function EvalsPage() {
  const app = useApp();
  const session = app.session;
  const seed = getSeed(app.clientId);
  const viewOnly = session ? isViewOnly(session.role, "evals") : false;
  const lq = app.lastQuery;

  const metrics = [
    { label: "Faithfulness", value: `${Math.round(EVAL_METRICS.faithfulness * 100)}%` },
    { label: "Citation accuracy", value: `${Math.round(EVAL_METRICS.citationAccuracy * 100)}%` },
    { label: "Answer relevance", value: `${Math.round(EVAL_METRICS.answerRelevance * 100)}%` },
    { label: "Hallucination rate", value: `${(EVAL_METRICS.hallucinationRate * 100).toFixed(1)}%` },
  ];

  return (
    <div>
      <div className="pagehead">
        <h1>Inspector &amp; Evals</h1>
        {viewOnly && <span className="chip warnchip">view only</span>}
      </div>

      <div className="klabel">RAG pipeline</div>
      <div className="pipeline">
        {PIPELINE.map((p, i) => (
          <span key={p} className="pipelinewrap">
            <span className="pipestage">{p}</span>
            {i < PIPELINE.length - 1 && <span className="pipearrow">→</span>}
          </span>
        ))}
      </div>

      <div style={{ margin: "10px 0 4px", fontSize: 13, lineHeight: 1.7 }}>
        <div>
          <strong>ingest</strong> — documents are split into fragments and turned
          into vectors (indexing).
        </div>
        <div>
          <strong>retrieve</strong> — the most relevant fragments are pulled for
          the question.
        </div>
        <div>
          <strong>rerank</strong> — they are re-ordered (our hybrid rerank:
          semantics + keywords).
        </div>
        <div>
          <strong>generate</strong> — the model composes the answer only from
          those fragments.
        </div>
        <div>
          <strong>cite</strong> — citations to the source are attached to the
          answer.
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          A visual of the process — so it&apos;s clear this is an engineered
          pipeline, not &ldquo;magic&rdquo;.
        </div>
      </div>

      <div className="klabel" style={{ marginTop: 18 }}>
        Live inspector — last query <span className="chip okchip">REAL</span>
      </div>
      {!lq && (
        <div className="ask" style={{ marginBottom: 18 }}>
          <span className="muted">
            No query yet in this session. Run one on the{" "}
            <Link href="/ask" className="doclink">
              Ask screen
            </Link>{" "}
            and the retrieved chunks + scores will appear here.
          </span>
        </div>
      )}
      {lq && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="cardbody">
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>{lq.clientName}</strong> · “{lq.question}”
            </div>
            <div className="klabel">
              Guardrail: top score {lq.result.topScore} —{" "}
              {lq.result.refused
                ? "below threshold → refused"
                : "above threshold → answer allowed"}
            </div>
            {lq.result.sources.map((s, i) => (
              <div className="src" key={i}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>“{s.file}”</span>
                  <span style={{ color: "var(--ok)", fontWeight: 500 }}>{s.score}</span>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.min(100, Math.round(s.score * 100))}%` }} />
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {s.snippet}…
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="klabel">
        Quality metrics — golden set <span className="chip">seed</span>
      </div>
      <div className="cardgrid" style={{ marginBottom: 6 }}>
        {metrics.map((m) => (
          <div className="statcard" key={m.label}>
            <div className="statnum">{m.value}</div>
            <div className="statlabel">{m.label}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Metrics evaluated offline on the {EVAL_METRICS.goldenSetSize}-question
        golden set across both clients (last run {EVAL_METRICS.lastRun}). Seeded
        in this demo; the live pipeline above is real.
      </p>

      <div className="klabel" style={{ marginTop: 12 }}>
        Golden test set — {seed.client} ({seed.goldens.length} questions)
      </div>
      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Expected answer</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {seed.goldens.map((g, i) => (
              <tr key={i}>
                <td>{g.q}</td>
                <td className="muted">{g.expected}</td>
                <td className="muted">{g.source}</td>
                <td>
                  <span className="chip okchip">pass</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
