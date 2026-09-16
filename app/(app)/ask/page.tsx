"use client";

import { useEffect, useRef, useState } from "react";
import { getSeed } from "@/lib/seeds";
import type { QueryResult, Source } from "@/lib/types";
import { useApp } from "../../providers";

// Ask / Q&A — the REAL RAG screen. Two-pane layout: the answer + clickable
// citations on the left; a live source viewer on the right that opens the cited
// document IN PLACE and highlights the fragment, so you can walk citations
// without leaving the page. Retrieval is scoped to the active client's index.

function locateSnippet(
  text: string,
  snippet: string
): { start: number; end: number } | null {
  const map: number[] = [];
  let hay = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (hay.length === 0 || hay.endsWith(" ")) continue;
      hay += " ";
      map.push(i);
    } else {
      hay += ch.toLowerCase();
      map.push(i);
    }
  }
  let needle = snippet.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return null;
  if (needle.length > 120) needle = needle.slice(0, 120);
  let idx = hay.indexOf(needle);
  if (idx === -1 && needle.length > 60) {
    needle = needle.slice(0, 60);
    idx = hay.indexOf(needle);
  }
  if (idx === -1) return null;
  const endMapIdx = Math.min(idx + needle.length - 1, map.length - 1);
  return { start: map[idx], end: map[endMapIdx] + 1 };
}

const STOP = new Set(
  "the a an and or of to in for on at by with from that this these those is are was were be been being as it its their our your they them we you shall will may must can could would should not no any all each which who whose what when where how than then thereof herein hereto hereof pursuant such other into out agreement contract clause section article document documents provided source relevant contains contain defined define terms term".split(
    /\s+/
  )
);

function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/\d+(?:\.\d+)?|[a-z][a-z0-9/]*[a-z0-9]/g) || []).filter(
    (w) => w.length >= 3 && !STOP.has(w)
  );
}
function quotedPhrases(s: string): string[] {
  return Array.from(s.matchAll(/["“”']([^"“”']{3,60})["“”']/g))
    .map((m) => m[1].trim().toLowerCase())
    .filter(Boolean);
}

// Highlight the citation the user clicked.
//
// Two steps, in this order — the order is the whole point:
//   1. Locate the chunk that retrieval ACTUALLY returned, by searching for the
//      snippet. The snippet is a literal copy of the chunk's opening, so this is
//      an exact lookup, not a guess.
//   2. Inside that chunk only, pick the line that best matches the answer, so the
//      jump lands on the precise clause rather than the top of a long chunk.
//
// Step 2 used to run over the WHOLE document, with step 1 as a fallback. That
// let a citation land anywhere: asked about renewal, the scorer highlighted an
// insurance clause in a different contract simply because it shared the words
// "deliver", "notice", "renewal" and "days". Scoring can now only ever choose
// between lines that were genuinely retrieved.
function bestHighlight(
  text: string,
  answer: string,
  snippet: string,
  chunkChars: number
): { start: number; end: number } | null {
  const chunk = locateSnippet(text, snippet);
  if (!chunk) return null; // snippet isn't in this document — highlight nothing

  // The snippet match only covers the chunk's opening; extend to the full chunk.
  const chunkStart = chunk.start;
  const chunkEnd = Math.min(text.length, chunkStart + Math.max(chunkChars, snippet.length));

  const body = answer.split(/\(\s*source/i)[0];
  const weights = new Map<string, number>();
  for (const t of contentTokens(body)) {
    const w = /\d/.test(t) ? 7 : Math.min(t.length, 10);
    weights.set(t, Math.max(weights.get(t) || 0, w));
  }
  const phrases = quotedPhrases(body);

  let off = 0;
  let best: { start: number; end: number } | null = null;
  let bestScore = 0;
  for (const ln of text.split("\n")) {
    const start = off;
    const end = off + ln.length;
    off = end + 1;
    if (start < chunkStart || end > chunkEnd) continue; // outside the retrieved chunk
    const low = ln.toLowerCase();
    if (low.trim().length < 4) continue;
    let s = 0;
    for (const [t, w] of weights) if (low.includes(t)) s += w;
    for (const p of phrases) if (low.includes(p)) s += 25;
    if (s > bestScore) {
      bestScore = s;
      best = { start, end };
    }
  }

  // A confident line inside the chunk, else the chunk itself — either way the
  // highlight stays within text that was really retrieved.
  if (best && bestScore >= 7) return best;
  return { start: chunkStart, end: chunkEnd };
}

type Selected = {
  fileName: string;
  title: string;
  snippet: string;
  chunkChars: number;
  key: string;
};

// One citation per distinct document (keep the highest-scoring chunk per doc).
// Raw per-chunk retrieval stays visible in the Inspector.
function dedupeByDoc(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!seen.has(s.fileName)) {
      seen.add(s.fileName);
      out.push(s);
    }
  }
  return out;
}

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

  let viewerContent: React.ReactNode = null;
  if (docText && selected) {
    const loc = bestHighlight(docText, result?.answer ?? "", selected.snippet, selected.chunkChars);
    if (loc) {
      viewerContent = (
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
    } else {
      viewerContent = docText;
    }
  }

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
                    {result.refused
                      ? "below threshold → refused"
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
