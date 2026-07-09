"use client";

import { useState } from "react";
import register from "@/data/register.json";

type Source = { file: string; score: number; snippet: string };
type QueryResult = {
  answer: string;
  refused: boolean;
  sources: Source[];
  topScore: number;
};

export default function Page() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setQuestion(text);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data as QueryResult);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <div className="head">
          <strong>📁 Client: {register.client}</strong>
          <span className="chip">{register.register.length} documents</span>
          <span style={{ flex: 1 }} />
          <span className="chip">Next.js + LlamaIndex.TS · RAG</span>
        </div>

        <div className="body">
          {/* Register */}
          <div className="klabel">Contract register (human-confirmed)</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 22 }}>
            <table>
              <thead>
                <tr>
                  <th>Document</th><th>Term / renewal</th><th>Governing law</th><th>Parties</th><th>Key clause</th>
                </tr>
              </thead>
              <tbody>
                {register.register.map((r, i) => (
                  <tr key={i}>
                    <td>{r.doc}</td><td>{r.term}</td><td>{r.law}</td><td>{r.parties}</td><td>{r.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ask (live RAG) */}
          <div className="klabel">Ask about the contracts (live RAG + citations)</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Ask about this client's contracts…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(question)}
            />
            <button className="primarybtn" onClick={() => ask(question)} disabled={loading}>
              {loading ? "…" : "Ask"}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {register.presets.map((p, i) => (
              <button key={i} className={`qbtn ${question === p ? "active" : ""}`} onClick={() => ask(p)}>
                {p.length > 46 ? p.slice(0, 44) + "…" : p}
              </button>
            ))}
          </div>

          <div className="ask" style={{ marginBottom: 8 }}>
            {!result && !loading && !error && (
              <span className="muted">Pick a question or type your own — answers are built only from this client's documents.</span>
            )}
            {loading && <span className="muted">Searching the contracts…</span>}
            {error && <span style={{ color: "var(--danger)" }}>⚠ {error}</span>}
            {result && (
              <div>
                <div style={{ fontWeight: 500, color: result.refused ? "var(--warn)" : "var(--text)", marginBottom: 8, whiteSpace: "pre-wrap" }}>
                  {result.answer}
                </div>
                {!result.refused &&
                  result.sources.slice(0, 4).map((s, i) => (
                    <span className="cit" key={i}>“{s.file}” · score {s.score}</span>
                  ))}
              </div>
            )}
          </div>

          {result && (
            <div style={{ marginBottom: 22 }}>
              <button className="qbtn" onClick={() => setShowInspector((v) => !v)}>
                {showInspector ? "▾ Hide Inspector" : "▸ Inspector (retrieved chunks + scores)"}
              </button>
              {showInspector && (
                <div style={{ marginTop: 10 }}>
                  <div className="klabel">Guardrail: top score {result.topScore} — {result.refused ? "below threshold → refused" : "above threshold → answer allowed"}</div>
                  {result.sources.map((s, i) => (
                    <div className="src" key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>“{s.file}”</span>
                        <span style={{ color: "var(--ok)", fontWeight: 500 }}>{s.score}</span>
                      </div>
                      <div className="bar"><i style={{ width: `${Math.min(100, Math.round(s.score * 100))}%` }} /></div>
                      <div className="muted" style={{ marginTop: 6 }}>{s.snippet}…</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Flags */}
          <div className="klabel">Risk &amp; deadline flags</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {register.flags.map((f, i) => (
              <div className={`flag ${f.level}`} key={i}>
                <span>
                  {f.level === "warn" ? "⏰" : f.level === "danger" ? "⚠" : "🛡"}
                </span>
                <div style={{ fontSize: 13 }}>
                  <strong>{f.doc}:</strong> {f.text} <span className="muted">[{f.cite}]</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        The register and flags are a human-confirmed seed. Query answers are generated live via RAG (LlamaIndex.TS) over the real contracts in <code>data/contracts</code>, with citations and a guardrail. The tool extracts facts from documents and does not give legal advice.
      </p>
    </div>
  );
}
