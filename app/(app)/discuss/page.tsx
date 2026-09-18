"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSeed } from "@/lib/seeds";
import type { Turn } from "@/lib/conversation";
import { bestHighlight, dedupeByDoc, type Selected } from "@/lib/highlight";
import type { Source } from "@/lib/types";
import { useApp } from "../../providers";

// Discussion — a deliberately TEMPORARY multi-turn mode.
//
// The Ask screen stays single-shot: every answer there stands on its own, which
// is what makes it auditable. This is the other mode, for when one question is
// not enough, and it is explicit about being throwaway:
//
//   • the transcript lives in this component's state and nowhere else — no
//     server session, no database, no app-level store. Navigating away unmounts
//     the component and the conversation is gone.
//   • switching client clears it too. A transcript about one tenant's contracts
//     must not survive into another's.
//
// Answers are produced by the same pipeline as Ask — same retrieval, same
// guardrail, same citations — so a discussion turn is not a weaker answer. The
// only addition is that a follow-up is rewritten into a standalone question
// before it is searched (see lib/conversation.ts).

type Message = {
  role: "user" | "assistant";
  content: string;
  // Assistant messages carry the evidence behind them.
  sources?: Source[];
  refused?: boolean;
  topScore?: number;
  /** The standalone question retrieval ran on, when it differed from what was typed. */
  searchedFor?: string;
};

/**
 * Carry the Ask screen's last exchange in as turn 1.
 *
 * Includes REFUSED answers on purpose: "Not found in the provided documents" is
 * still context, and is often exactly why someone wants to rephrase. Landing on
 * an empty screen after clicking "Continue as discussion" is worse than seeing
 * an answer that happened to be negative.
 */
function seedFrom(
  lq: ReturnType<typeof useApp>["lastQuery"],
  clientId: string
): Message[] {
  if (!lq || lq.clientId !== clientId) return [];
  return [
    { role: "user", content: lq.question },
    {
      role: "assistant",
      content: lq.result.answer,
      sources: lq.result.sources,
      refused: lq.result.refused,
      topScore: lq.result.topScore,
    },
  ];
}

export default function DiscussPage() {
  const app = useApp();
  const router = useRouter();
  const seed = getSeed(app.clientId);

  // Seeded synchronously rather than in an effect. React StrictMode (on by
  // default in Next dev) mounts, unmounts and remounts; an effect that seeds
  // once and then guards on a ref never runs its seed again after that
  // simulated remount, because refs survive it while state does not. A useState
  // initializer re-runs, so the carry-over survives.
  const [messages, setMessages] = useState<Message[]>(() =>
    seedFrom(app.lastQuery, app.clientId)
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Right pane — the same live source viewer the Ask screen has, using the same
  // highlight logic (lib/highlight.ts). A citation you cannot open is not
  // evidence, and that has to hold in a discussion as much as in a single answer.
  const [selected, setSelected] = useState<Selected | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  /** The answer the open citation came from — the highlighter scores against it. */
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const markRef = useRef<HTMLElement | null>(null);
  /** The client the open session belongs to, for detecting a real tenant switch. */
  const openedFor = useRef<string>(app.clientId);

  // A transcript belongs to one tenant. Switching client ends this session and
  // starts a fresh one for the client now selected.
  //
  // Only a REAL change does anything — no mount-time work here, because the
  // useState initializer above already handled that.
  useEffect(() => {
    if (openedFor.current === app.clientId) return;
    openedFor.current = app.clientId;
    app.clearLog("discuss");
    setMessages(seedFrom(app.lastQuery, app.clientId));
    setInput("");
    setError(null);
    setSelected(null);
    setDocText(null);
    setDocError(null);
  }, [app.clientId, app.lastQuery]);

  // No unmount cleanup touches component STATE. Unmounting already discards it —
  // that IS the "leaving the page clears it" guarantee — and a cleanup calling
  // setMessages([]) wipes the seed during StrictMode's simulated unmount, which
  // is exactly the bug this file used to have.
  //
  // The audit log is different: it lives in the app-level store, so unmounting
  // does NOT clear it, and the footer's promise covers leaving the page as well
  // as End session. Hence this one cleanup. It is safe under StrictMode's
  // mount/unmount/remount precisely because it touches no state the seed depends
  // on — and because on a fresh mount there are no "discuss" entries from this
  // session yet, so the simulated unmount has nothing of this session's to lose.
  useEffect(() => {
    return () => {
      app.clearLog("discuss");
    };
  }, [app.clearLog]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // Load whichever document the user clicked into the right pane.
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

  useEffect(() => {
    if (docText && markRef.current) {
      markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [docText, selected]);

  function openCitation(s: Source, answer: string, key: string) {
    if (!s.fileName) return;
    setSelectedAnswer(answer);
    setSelected({
      fileName: s.fileName,
      title: s.file,
      snippet: s.snippet,
      chunkChars: s.chunkChars,
      key,
    });
  }

  // Memoised — see the same note on the Ask screen. It matters more here: the
  // input is used repeatedly in a conversation, and every keystroke would
  // otherwise re-scan the whole open document (up to 110,425 characters) and
  // re-render a <pre> containing all of it.
  const viewerContent: React.ReactNode = useMemo(() => {
    if (!docText || !selected) return docText;
    const loc = bestHighlight(docText, selectedAnswer, selected.snippet, selected.chunkChars);
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
  }, [docText, selected, selectedAnswer]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    // The tenant this question belongs to. The client selector in the app shell
    // stays enabled while a request is in flight, so by the time this resolves
    // the active client may be a different one — and openedFor/the effect above
    // will already have reset the transcript to that tenant's seed. Appending
    // regardless would put one client's answer, sources and citations under
    // another client's heading. Checked in BOTH branches below.
    const askedFor = app.clientId;
    setBusy(true);
    setError(null);
    setInput("");
    const asked: Message = { role: "user", content: text };
    setMessages((m) => [...m, asked]);

    try {
      // Only role/content go to the server; the sources stay client-side.
      const history: Turn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: askedFor, history, question: text }),
      });
      if (!res.ok) {
        const body = await res.text();
        let message = `Request failed (${res.status})`;
        try {
          message = (JSON.parse(body).error as string) || message;
        } catch {
          /* non-JSON error page */
        }
        throw new Error(message);
      }
      const data = await res.json();
      if (openedFor.current !== askedFor) return; // answer belongs to a session that is gone
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.result.answer,
          sources: data.result.sources,
          refused: data.result.refused,
          topScore: data.result.topScore,
          searchedFor: data.rewritten ? data.searchedFor : undefined,
        },
      ]);
      app.log("discuss", `[${seed.client}] ${text}`);
    } catch (e: any) {
      // Same guard: without it this would truncate the NEW tenant's freshly
      // seeded transcript instead of dropping the question it was meant to.
      if (openedFor.current !== askedFor) return;
      setError(e.message);
      // Drop the unanswered question so the transcript never implies the model
      // saw something it did not.
      setMessages((m) => m.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  function endSession() {
    // Clear first, then leave. Navigating away unmounts this component and
    // discards its state anyway, but clearing explicitly means the transcript is
    // gone before the route transition rather than during it.
    //
    // The audit entries go with it. The footer promises this conversation is
    // discarded on End session, and questions left sitting in the app-wide log
    // (visible on Settings) made that promise false.
    app.clearLog("discuss");
    setMessages([]);
    setInput("");
    setError(null);
    setSelected(null);
    setDocText(null);
    setDocError(null);
    router.push("/ask");
  }

  return (
    <div>
      <div className="pagehead">
        <h1>Discussion</h1>
        <span className="chip okchip">REAL RAG</span>
        <span className="chip warnchip" title="Nothing here is stored. Leaving this page ends the session.">
          temporary session
        </span>
        <span className="muted">
          Follow-up questions about {seed.client}&apos;s documents — same retrieval and
          guardrail as Ask.
        </span>
      </div>

      {messages.length === 0 && (
        <div className="ask" style={{ marginBottom: 10 }}>
          <span className="muted">
            Start on the{" "}
            <Link href="/ask" className="doclink">
              Ask screen
            </Link>
            , then choose <b>Continue as discussion</b> — your question and answer carry
            over so follow-ups have something to refer back to. Or just type below.
          </span>
        </div>
      )}

      <div className="askgrid">
        {/* LEFT — the transcript */}
        <div>
        {messages.map((m, i) => (
          <div key={i} className="ask" style={{ marginBottom: 8 }}>
            <div className="klabel" style={{ marginBottom: 4 }}>
              {m.role === "user" ? "You" : "Contract Intelligence"}
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                color: m.refused ? "var(--warn)" : "var(--text)",
                fontWeight: m.role === "user" ? 500 : 400,
              }}
            >
              {m.content}
            </div>

            {/* When a follow-up was rewritten, show what was actually searched.
                Otherwise the citations look unrelated to what the user typed. */}
            {m.searchedFor && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                searched for: &ldquo;{m.searchedFor}&rdquo;
              </div>
            )}

            {m.role === "assistant" && !m.refused && m.sources && m.sources.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {/* One button per distinct document, opening it in the right
                    pane at the cited clause — same behaviour as Ask, so a
                    citation is checkable without leaving the conversation. */}
                {dedupeByDoc(m.sources)
                  .slice(0, 4)
                  .map((s, j) => (
                    <button
                      key={j}
                      className={`cit citbtn ${selected?.key === `${i}-${j}` ? "active" : ""}`}
                      title="Open the document at this fragment"
                      onClick={() => openCitation(s, m.content, `${i}-${j}`)}
                    >
                      “{s.file}” · score {s.score ?? "BM25"} →
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="ask" style={{ marginBottom: 8 }}>
            <span className="muted">Searching the contracts…</span>
          </div>
        )}
        <div ref={endRef} />

        {error && <div className="errorbox" style={{ marginBottom: 8 }}>⚠ {error}</div>}
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
                Click a citation on the left — the document opens here with the cited
                clause highlighted.
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

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          placeholder={
            messages.length ? "Ask a follow-up…" : `Ask about ${seed.client}'s contracts…`
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={busy}
        />
        <button className="primarybtn" onClick={send} disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
        {messages.length > 0 && (
          <button className="qbtn" onClick={endSession} disabled={busy}>
            End session
          </button>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        The <b>transcript</b> is held in the browser only — it is never written to
        the server or the database, and it is discarded when you leave this page,
        switch client, or press <b>End session</b>. Individual <b>questions</b> are
        recorded in the admin monitoring log, the same as questions asked on the Ask
        screen, so refusals and slow queries can be investigated. Each follow-up is
        rewritten into a standalone question before searching, so &ldquo;how much
        notice to stop it?&rdquo; finds the right clause; the guardrail then runs on
        that rewritten question, not on the conversation.
      </p>
    </div>
  );
}
