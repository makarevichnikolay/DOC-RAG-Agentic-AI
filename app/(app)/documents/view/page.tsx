"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApp } from "../../../providers";

// Document viewer with citation jump: /documents/view?file=X&q=<snippet>
// Locates the cited snippet in the full text, highlights it and scrolls to it.

function locateSnippet(
  text: string,
  snippet: string
): { start: number; end: number } | null {
  // Build a whitespace-collapsed, lowercased haystack with an index map back
  // to the original text (citation snippets have collapsed whitespace).
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

function Viewer() {
  const params = useSearchParams();
  const file = params.get("file") ?? "";
  const q = params.get("q") ?? "";
  const { clientId } = useApp();

  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    if (!file) {
      setError("No document specified.");
      return;
    }
    fetch(
      `/api/document?clientId=${encodeURIComponent(clientId)}&file=${encodeURIComponent(file)}`
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load document");
        if (!cancelled) setText(data.text as string);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [file, clientId]);

  useEffect(() => {
    if (text && q && markRef.current) {
      markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [text, q]);

  let content: React.ReactNode = null;
  if (text) {
    const loc = q ? locateSnippet(text, q) : null;
    if (loc) {
      content = (
        <>
          {text.slice(0, loc.start)}
          <mark
            className="citehl"
            ref={(el) => {
              markRef.current = el;
            }}
          >
            {text.slice(loc.start, loc.end)}
          </mark>
          {text.slice(loc.end)}
        </>
      );
    } else {
      content = text;
    }
  }

  return (
    <div>
      <div className="pagehead">
        <h1 style={{ fontSize: 17 }}>
          {file.replace(/\.txt$/i, "").replace(/^\d+_/, "").replace(/_/g, " ")}
        </h1>
        <span style={{ flex: 1 }} />
        <Link className="qbtn" href="/documents">
          ← Back to documents
        </Link>
      </div>

      {q && (
        <div className="processbar">
          Jumped to the cited fragment{" "}
          <span className="muted">(highlighted below)</span>
        </div>
      )}

      {!text && !error && <div className="muted">Loading document…</div>}
      {error && <div className="errorbox">⚠ {error}</div>}
      {text && <pre className="docview">{content}</pre>}
    </div>
  );
}

export default function DocumentViewPage() {
  return (
    <Suspense fallback={<div className="muted">Loading document…</div>}>
      <Viewer />
    </Suspense>
  );
}
