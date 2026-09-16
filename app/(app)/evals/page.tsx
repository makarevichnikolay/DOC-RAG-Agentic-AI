"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSeed } from "@/lib/seeds";
import { isViewOnly } from "@/lib/access";
import type { EvalRun, GoldenResult } from "@/lib/evals";
import { useApp } from "../../providers";

const PIPELINE = ["ingest", "retrieve", "rerank", "generate", "cite"];

// The Status cell. Before a run it says so; it no longer says "pass" for
// questions nothing has asked.
function statusCell(r: GoldenResult | undefined) {
  if (!r) return <span className="chip">not run</span>;
  if (r.error) {
    return (
      <span className="chip failchip" title={r.error}>
        error
      </span>
    );
  }
  const chips: React.ReactNode[] = [
    <span key="v" className={`chip ${r.pass ? "okchip" : "failchip"}`}>
      {r.pass ? "pass" : "fail"}
    </span>,
  ];
  if (r.isProbe) {
    chips.push(
      <span key="p" className="chip" title="Off-topic probe: the pipeline must refuse it.">
        {r.refused ? "refused ✓" : "answered ✗"}
      </span>
    );
  } else {
    if (!r.refusalCorrect) chips.push(<span key="r" className="chip failchip">wrongly refused</span>);
    if (!r.citationsValid)
      chips.push(
        <span key="c" className="chip failchip" title="A cited snippet cannot be found in the document it claims to come from — the viewer would highlight nothing.">
          bad citation
        </span>
      );
    if (r.correctDocsCited === false)
      chips.push(<span key="d" className="chip warnchip" title="The document named in the golden's source was not among the cited sources.">wrong document</span>);
    if (r.correctness)
      chips.push(
        <span
          key="j"
          className={`chip ${r.correctness === "correct" ? "okchip" : r.correctness === "partial" ? "warnchip" : "failchip"}`}
          title={r.judgeNote ?? undefined}
        >
          {r.correctness}
        </span>
      );
    if (r.faithful === false)
      chips.push(
        <span key="f" className="chip failchip" title={r.judgeNote ?? "The answer asserts something the retrieved excerpts do not support."}>
          unfaithful
        </span>
      );
  }
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{chips}</span>;
}

// Inspector & Evals: the pipeline strip, live retrieved chunks + scores from
// the most recent Ask query (REAL), and quality metrics on the golden set (SEED).
export default function EvalsPage() {
  const app = useApp();
  const session = app.session;
  const seed = getSeed(app.clientId);
  const viewOnly = session ? isViewOnly(session.role, "evals") : false;
  const lq = app.lastQuery;

  const [run, setRun] = useState<EvalRun | null>(null);
  const [running, setRunning] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [useJudge, setUseJudge] = useState(true);

  // A run belongs to the client it was run against. Switching client must not
  // leave another tenant's numbers on screen.
  useEffect(() => {
    setRun(null);
    setEvalError(null);
  }, [app.clientId]);

  async function runEvals() {
    if (running || viewOnly) return;
    setRunning(true);
    setEvalError(null);
    setRun(null);
    try {
      // Captured now: `app.clientId` may change while the request is in flight.
      const ranFor = app.clientId;
      const res = await fetch("/api/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: ranFor, judge: useJudge }),
      });
      // res.ok BEFORE res.json(): a platform timeout (the route allows 300s,
      // which exceeds some hosts' limits) returns an HTML error page, and
      // parsing that first surfaces "Unexpected token '<'" instead of the
      // actual failure.
      if (!res.ok) {
        const body = await res.text();
        let message = `Eval run failed (${res.status})`;
        try {
          message = (JSON.parse(body).error as string) || message;
        } catch {
          if (res.status === 504 || res.status === 502) message += " — the run timed out.";
        }
        throw new Error(message);
      }
      const data = (await res.json()) as EvalRun;
      // The effect above clears `run` on client switch, but an in-flight request
      // resolving afterwards would still land here — rendering one tenant's
      // results under another tenant's questions, with a green "measured" chip.
      if (data.clientId !== ranFor || ranFor !== app.clientId) return;
      setRun(data);
      app.log("evals", `[${data.clientName}] ran ${data.summary.total} golden questions`);
    } catch (e: any) {
      setEvalError(e.message);
    } finally {
      setRunning(false);
    }
  }

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  // Before a run there is nothing to show, so nothing is shown.
  //
  // These four used to render invented constants (96% / 94% / 92% / 0.8%). A
  // "seed" label next to them was not enough: on a page whose purpose is to
  // stop presenting made-up numbers as measurements, the numbers have to go.
  // Empty slots keep the layout and say plainly what will be measured.
  const metrics = [
    { label: "Pass rate", value: run ? pct(run.summary.passRate) : "—" },
    { label: "Faithfulness", value: run ? pct(run.summary.faithfulness) : "—" },
    { label: "Citation validity", value: run ? pct(run.summary.citationValidity) : "—" },
    {
      label: "Hallucination rate",
      value:
        run && run.summary.hallucinationRate !== null
          ? `${(run.summary.hallucinationRate * 100).toFixed(1)}%`
          : "—",
    },
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
          <strong>retrieve</strong> — TWO searches run over the same chunks:
          semantic (embeddings) and lexical (BM25).
        </div>
        <div>
          <strong>rerank</strong> — the two rankings are merged with Reciprocal
          Rank Fusion: RRF(d) = Σ 1 / (k + rank), k=60.
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
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>“{s.file}”</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {s.via === "both"
                      ? `semantic #${s.semanticRank} + lexical #${s.lexicalRank}`
                      : s.via === "semantic"
                        ? `semantic #${s.semanticRank}`
                        : s.via === "neighbour"
                          ? `neighbour of #${s.neighbourOfRank} (not retrieved)`
                          : `lexical #${s.lexicalRank} (BM25 only)`}
                  </span>
                  <span style={{ color: "var(--ok)", fontWeight: 500 }}>{s.score ?? "—"}</span>
                </div>
                {s.score !== null && (
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, Math.round(s.score * 100))}%` }} />
                  </div>
                )}
                <div className="muted" style={{ marginTop: 6 }}>
                  {s.snippet}…
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="klabel" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>Quality metrics — golden set</span>
        {run ? (
          <span className="chip okchip">measured · {new Date(run.finishedAt).toLocaleTimeString()}</span>
        ) : (
          <span className="chip">not measured</span>
        )}
        <button className="primarybtn" onClick={runEvals} disabled={running || viewOnly}>
          {running ? "Running…" : run ? "Re-run evals" : "Run evals"}
        </button>
        <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={useJudge}
            disabled={running}
            onChange={(e) => setUseJudge(e.target.checked)}
            style={{ width: "auto" }}
          />
          LLM judge (answer correctness + faithfulness)
        </label>
      </div>
      {running && (
        <div className="ask" style={{ marginBottom: 8 }}>
          <span className="muted">
            Running {seed.goldens.length} golden questions through the real pipeline
            {useJudge ? ", then grading each answer" : ""}… this takes a few seconds per question.
          </span>
        </div>
      )}
      {evalError && (
        <div className="errorbox" style={{ marginBottom: 8 }}>⚠ {evalError}</div>
      )}
      <div className="cardgrid" style={{ marginBottom: 6 }}>
        {metrics.map((m) => (
          <div className="statcard" key={m.label}>
            <div className="statnum">{m.value}</div>
            <div className="statlabel">{m.label}</div>
          </div>
        ))}
      </div>
      {run ? (
        <div style={{ fontSize: 12, marginTop: 0 }}>
          <div>
            <strong>
              {run.summary.passed}/{run.summary.total} passed
            </strong>{" "}
            · refusal accuracy {pct(run.summary.refusalAccuracy)} · correct document cited{" "}
            {pct(run.summary.correctDocRate)} · graded{" "}
            {run.summary.correctness.correct} correct / {run.summary.correctness.partial} partial /{" "}
            {run.summary.correctness.incorrect} incorrect
          </div>
          <div className="muted" style={{ marginTop: 2 }}>
            {Math.round(run.durationMs / 100) / 10}s · avg {run.summary.avgMs}ms per question · avg
            context {run.summary.avgContextChars} chars · avg top score{" "}
            {run.summary.avgTopScore.toFixed(3)}
          </div>
          {/* A pass rate means nothing without the configuration behind it. */}
          <div className="muted" style={{ marginTop: 4 }}>
            {Object.entries(run.config).map(([k, v]) => (
              <span key={k} style={{ marginRight: 10 }}>
                <b>{k}</b> {String(v)}
              </span>
            ))}
          </div>
          {run.judged && (
            <div className="muted" style={{ marginTop: 4 }}>
              Note: by default the judge is the same model that wrote the answers,
              and models favour their own output. Set{" "}
              <code>EVAL_JUDGE_PROVIDER</code> and <code>EVAL_JUDGE_MODEL</code> to
              grade with another vendor.
              {run.summary.ungraded > 0 && (
                <>
                  {" "}
                  <b style={{ color: "var(--warn)" }}>
                    {run.summary.ungraded} question(s) could not be graded — the pass
                    rate above is not a quality measurement.
                  </b>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Nothing has been measured yet. Press <b>Run evals</b> to put all{" "}
          {seed.goldens.length} golden questions through the real pipeline — same
          retrieval, same guardrail, same model as the Ask screen.
        </p>
      )}

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
                <td>{statusCell(run?.results[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
