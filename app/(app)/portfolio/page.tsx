"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canAccess } from "@/lib/access";
import type { PortfolioResult } from "@/lib/types";
import { useApp } from "../../providers";

const PRESETS = [
  "Which contracts have a change of control clause?",
  "Which agreements auto-renew, and what notice is required to stop renewal?",
  "Which contracts require liability insurance, and at what amounts?",
];

// Portfolio (Admin): one question, every client — the same REAL RAG pipeline
// runs against each client's isolated index; results stay tagged per client.
export default function PortfolioPage() {
  const app = useApp();
  const router = useRouter();
  const session = app.session;

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PortfolioResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session || !canAccess(session.role, "portfolio")) {
    return (
      <div className="errorbox">
        ⚠ Access denied — the cross-client Portfolio view is available to
        Partner / Admin only. Use “Switch role” in the top bar.
      </div>
    );
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    setQuestion(text);
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResults(data.results as PortfolioResult[]);
      app.log("portfolio_query", text);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openCitation(clientId: string, fileName: string, snippet: string) {
    if (!fileName) return;
    app.setClient(clientId);
    router.push(
      `/documents/view?file=${encodeURIComponent(fileName)}&q=${encodeURIComponent(
        snippet.slice(0, 100)
      )}`
    );
  }

  return (
    <div>
      <div className="pagehead">
        <h1>Portfolio</h1>
        <span className="chip okchip">REAL cross-client RAG</span>
        <span className="muted">
          Admin-only: one question, every client — answers stay tagged per
          client.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Ask across all clients…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
        />
        <button className="primarybtn" onClick={() => ask(question)} disabled={loading}>
          {loading ? "…" : "Run"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {PRESETS.map((p, i) => (
          <button
            key={i}
            className={`qbtn ${question === p ? "active" : ""}`}
            onClick={() => ask(p)}
          >
            {p.length > 64 ? p.slice(0, 62) + "…" : p}
          </button>
        ))}
      </div>

      {loading && (
        <div className="processbar">
          <span className="spinner" /> Running the query against each client&apos;s
          isolated index…
        </div>
      )}
      {error && <div className="errorbox">⚠ {error}</div>}

      {results &&
        results.map((r) => (
          <div className="card" style={{ marginBottom: 12 }} key={r.clientId}>
            <div className="cardtitle">{r.clientName}</div>
            <div className="cardbody">
              {r.error && (
                <div style={{ color: "var(--danger)", fontSize: 13 }}>
                  ⚠ {r.error}
                </div>
              )}
              {r.result && (
                <>
                  <div
                    style={{
                      fontWeight: 500,
                      color: r.result.refused ? "var(--warn)" : "var(--text)",
                      marginBottom: 8,
                      whiteSpace: "pre-wrap",
                      fontSize: 14,
                    }}
                  >
                    {r.result.answer}
                  </div>
                  {!r.result.refused &&
                    r.result.sources.slice(0, 3).map((s, i) => (
                      <button
                        className="cit citbtn"
                        key={i}
                        onClick={() => openCitation(r.clientId, s.fileName, s.snippet)}
                        title="Open the document at this fragment (switches active client)"
                      >
                        “{s.file}” · score {s.score} ↗
                      </button>
                    ))}
                </>
              )}
            </div>
          </div>
        ))}

      <p className="muted" style={{ fontSize: 12 }}>
        Each client is queried separately against its own index, so results are
        attributable and isolation is preserved. Clicking a citation switches
        the active client and opens the document.
      </p>
    </div>
  );
}
