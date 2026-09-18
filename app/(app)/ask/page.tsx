"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSeed } from "@/lib/seeds";
import { bestHighlight, dedupeByDoc, type Selected } from "@/lib/highlight";
import type { QueryResult, Source } from "@/lib/types";
import { useApp } from "../../providers";

// Ask / Q&A — the REAL RAG screen. Two-pane layout: the answer + clickable
// citations on the left; a live source viewer on the right that opens the cited
// document IN PLACE and highlights the fragment, so you can walk citations
// without leaving the page. Retrieval is scoped to the active client's index.

export default function AskPage() {
  const app = useApp();
  const seed = getSeed(app.clientId);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  // right pane (source viewer)
  const [selected, setSelected] = useState<Selected | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement | null>(null);

  // Switching client clears everything (no leakage on screen).
  useEffect(() => {
    setResult(null);
    setError(null);
    setQuestion("");
    setSelected(null);
    setDocText(null);
    setDocError(null);
  }, [app.clientId]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    setQuestion(text);
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    setDocText(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, clientId: app.clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const qr = data as QueryResult;
      setResult(qr);
      app.setLastQuery({
        clientId: app.clientId,
        clientName: seed.client,
        question: text,
        result: qr,
      });
      app.log("query", `[${seed.client}] ${text}`);
      // auto-open the top citation (per-document) in the right pane
      const uniq = dedupeByDoc(qr.sources);
      if (!qr.refused && uniq[0]?.fileName) {
        selectCitation(uniq[0], 0);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function selectCitation(s: Source, i: number) {
    if (!s.fileName) return;
    setSelected({
      fileName: s.fileName,
      title: s.file,
      snippet: s.snippet,
      chunkChars: s.chunkChars,
      key: `${s.fileName}-${i}`,
    });
  }

  // Load the selected document into the right pane.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDocText(null);
    setDocError(null);
    setDocLoading(true);
    fetch(
      `/api/document?clientId=${encodeURIComponent(app.clientId)}&file=${encodeURIComponent(selected.fileName)}`
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load document");
        if (!cancelled) setDocText(data.text as string);
      })
      .catch((e) => !cancelled && setDocError(e.message))
      .finally(() => !cancelled && setDocLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, app.clientId]);

  // Scroll the highlight into view within the viewer.
  useEffect(() => {
    if (docText && markRef.current) {
      markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [docText, selected]);

  // Memoised because this is expensive and typing must not pay for it.
  //
  // bestHighlight -> locateSnippet walks the document one character at a time,
  // building a position map and a lowercased copy: 110,425 characters for the
  // Master Services Agreement. Computed inline during render, that ran on every
  // keystroke in the question box — the input visibly froze. None of its inputs
  // change while typing, so it belongs behind useMemo.
  const viewerContent: React.ReactNode = useMemo(() => {
    if (!docText || !selected) return null;
    const loc = bestHighlight(docText, result?.answer ?? "", selected.snippet, selected.chunkChars);
    if (!loc) return docText;
    return (
      <>
        {docText.slice(0, loc.start)}
        <mark
          className="citehl"
          ref={(el) => {
            markRef.current = el;
          }}
        >
          {docText.slice(loc.start, loc.end)}
        </mark>
        {docText.slice(loc.end)}
      </>
    );
  }, [docText, selected, result?.answer]);

  return (
    <div>
      <div className="pagehead">
        <h1>Ask (Q&amp;A)</h1>
        <span className="chip okchip">REAL RAG</span>
        <span className="muted">
          Answers are built only from {seed.client}&apos;s documents — isolated
          retrieval.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          placeholder={`Ask about ${seed.client}'s contracts…`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
        />
        <button className="primarybtn" onClick={() => ask(question)} disabled={loading}>
          {loading ? "…" : "Ask"}
        </button>
        {/* The way into the throwaway multi-turn mode. Beside the input rather
            than under the answer: a long answer pushed it below the fold, which
            is exactly when someone wants to follow up. Shown only once there is
            an answer worth following up on. */}
        {/* Shown after ANY answer, including a refusal — "it did not find that,
            let me ask differently" is one of the main reasons to open a
            discussion in the first place. */}
        {result && (
          <Link
            className="qbtn"
            href="/discuss"
            title="Ask follow-up questions in a temporary session — nothing is stored"
            style={{ whiteSpace: "nowrap", alignSelf: "center" }}
          >
            Continue as discussion →
          </Link>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {seed.presets.map((p, i) => (
          <button
            key={i}
            className={`qbtn ${question === p ? "active" : ""}`}
            onClick={() => ask(p)}
          >
            {p.length > 56 ? p.slice(0, 54) + "…" : p}
          </button>
        ))}
      </div>

      {/* two-pane: answer (left) + live source viewer (right) */}
      <div className="askgrid">
        {/* LEFT */}
        <div>
          <div className="ask" style={{ marginBottom: 8 }}>
            {!result && !loading && !error && (
              <span className="muted">
                Pick a preset or type your own question. The last preset is a
                guardrail probe — the system should honestly refuse.
              </span>
            )}
            {loading && <span className="muted">Searching the contracts…</span>}
            {error && <span style={{ color: "var(--danger)" }}>⚠ {error}</span>}
            {result && (
              <div>
                <div
                  style={{
                    fontWeight: 500,
                    color: result.refused ? "var(--warn)" : "var(--text)",
                    marginBottom: 8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {result.answer}
                </div>
                {!result.refused && (
                  <div>
                    {dedupeByDoc(result.sources).slice(0, 4).map((s, i) => (
                      <button
                        className={`cit citbtn ${selected?.key === `${s.fileName}-${i}` ? "active" : ""}`}
                        key={i}
                        title="Open the document at this fragment (right pane)"
                        onClick={() => selectCitation(s, i)}
                      >
                        “{s.file}” · score {s.score ?? "BM25"} →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {result && (
            <div>
              <button className="qbtn" onClick={() => setShowInspector((v) => !v)}>
                {showInspector
                  ? "▾ Hide Inspector"
                  : "▸ Inspector (retrieved chunks + scores)"}
              </button>
              {showInspector && (
                <div style={{ marginTop: 10 }}>
                  <div className="klabel">
                    Guardrail: top score {result.topScore} —{" "}
                    {result.refusedBy === "guardrail"
                      ? "below threshold → refused before any model call"
                      : result.refusedBy === "model"
                        ? "above threshold → excerpts sent, but the model found no answer in them"
                        : "above threshold → answer allowed"}
                  </div>
                  {result.sources.map((s, i) => (
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
                        <span style={{ color: "var(--ok)", fontWeight: 500 }}>
                          {s.score ?? "—"}
                        </span>
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
              )}
            </div>
          )}
        </div>

        {/* RIGHT — live source viewer */}
        <div className="sourcepane">
          <div className="sourcehead">
            <span style={{ fontWeight: 500 }}>
              {selected ? `Source · ${selected.title}` : "Source document"}
            </span>
            {selected && <span className="chip okchip">cited fragment</span>}
          </div>
          <div className="sourcebody">
            {!selected && (
              <div className="muted" style={{ padding: 16, fontSize: 13 }}>
                Ask a question, then click a citation on the left — the document
                opens here with the cited clause highlighted. Click through
                citations without leaving the page.
              </div>
            )}
            {selected && docLoading && (
              <div className="muted" style={{ padding: 16 }}>Loading document…</div>
            )}
            {selected && docError && (
              <div className="errorbox" style={{ margin: 12 }}>⚠ {docError}</div>
            )}
            {selected && docText && <pre className="docview">{viewerContent}</pre>}
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Live RAG (LlamaIndex.TS) over the real contracts in this client&apos;s
        folder, with citations and a relevance guardrail. Citations are grouped
        one per source document — click to open it on the right at the relevant
        clause; the Inspector lists every retrieved fragment with its score. The
        tool extracts facts from documents and does not give legal advice.
      </p>
    </div>
  );
}
