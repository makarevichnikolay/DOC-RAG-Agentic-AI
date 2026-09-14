"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getSeed } from "@/lib/seeds";
import { useApp } from "../../providers";

import type { Flag } from "@/lib/types";

type IngestResp = {
  fileName: string;
  title: string;
  chars: number;
  preview: string;
  engine: string;
  mode?: string;
  flags?: Flag[];
  error?: string;
};

type Engine = "cloud" | "tesseract";

// Documents list + REAL OCR upload: a scanned page (PNG/JPG) or a .txt file is
// recognized (OpenAI vision), the text is ingested into the client's live RAG
// index, and it becomes answerable in Ask straight away.
export default function DocumentsPage() {
  const app = useApp();
  const seed = getSeed(app.clientId);
  const uploaded = app.uploads[app.clientId] ?? [];
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResp | null>(null);
  const [engine, setEngine] = useState<Engine>("cloud");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStage("Uploading & recognizing (OCR)…");
    try {
      const fd = new FormData();
      fd.append("clientId", app.clientId);
      fd.append("engine", engine);
      fd.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data: IngestResp = await res.json();
      if (!res.ok) throw new Error(data.error || "Ingest failed");
      setStage("Chunking & embedding into the index…");
      app.addUpload(app.clientId, {
        file: data.fileName,
        title: data.title,
        type: "Uploaded · OCR",
        parties: "—",
        date: new Date().toISOString().slice(0, 10),
        law: "—",
      });
      if (data.flags?.length) app.addFlags(app.clientId, data.flags);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStage("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const rows = [...seed.documents, ...uploaded];

  return (
    <div>
      <div className="pagehead">
        <h1>Documents</h1>
        <span className="muted">{seed.client}</span>
        <span style={{ flex: 1 }} />
        <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          OCR engine:
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as Engine)}
            disabled={busy}
            style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }}
          >
            <option value="cloud">Cloud vision (LLM_PROVIDER)</option>
            <option value="tesseract">Tesseract (local / on-prem)</option>
          </select>
        </label>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md"
          style={{ display: "none" }}
          onChange={onFile}
        />
        <button
          className="primarybtn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Processing…" : "Upload & recognize (OCR)"}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        Upload a scanned page (PNG/JPG/WEBP), a PDF (text-layer is read directly; scans are
        rasterized &amp; OCR&apos;d), or a .txt file. The recognized text is indexed — then ask about it in Ask.
        The engine toggle shows the on-prem path: Tesseract keeps everything local.
      </p>

      {busy && (
        <div className="processbar">
          <span className="spinner" /> {stage}
        </div>
      )}

      {error && (
        <div className="processbar" style={{ color: "var(--danger)" }}>
          ⚠ {error}
        </div>
      )}

      {result && (
        <div className="tablecard" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            ✅ Recognized “{result.title}” — {result.chars.toLocaleString()} characters
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {result.engine}{result.mode ? ` · ${result.mode}` : ""} · indexed into {seed.client}. Now ask about it in Ask.
          </div>
          {result.flags && result.flags.length > 0 && (
            <div
              style={{
                fontSize: 13,
                background: "#fff7e6",
                border: "1px solid #f0d9a8",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 8,
              }}
            >
              ⚑ {result.flags.length} risk flag{result.flags.length > 1 ? "s" : ""} auto-detected —{" "}
              <Link className="doclink" href="/flags">
                review in Flags &amp; Tasks →
              </Link>
            </div>
          )}
          <div
            style={{
              fontSize: 12,
              background: "var(--bg, #f6f7f9)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              maxHeight: 150,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {result.preview}…
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <Link
              className="qbtn"
              href={`/documents/view?file=${encodeURIComponent(result.fileName)}`}
            >
              Open recognized text
            </Link>
            <Link className="qbtn" href="/ask">
              Ask about it →
            </Link>
          </div>
        </div>
      )}

      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Type</th>
              <th>Parties</th>
              <th>Date</th>
              <th>Governing law</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.file}>
                <td>
                  <Link
                    className="doclink"
                    href={`/documents/view?file=${encodeURIComponent(d.file)}`}
                  >
                    {d.title}
                  </Link>
                  {uploaded.some((u) => u.file === d.file) && (
                    <span className="chip" style={{ marginLeft: 6, background: "#E2EFDA", color: "#375623" }}>
                      uploaded · OCR · indexed
                    </span>
                  )}
                </td>
                <td>{d.type}</td>
                <td>{d.parties}</td>
                <td>{d.date}</td>
                <td>{d.law}</td>
                <td>
                  <Link
                    className="qbtn"
                    href={`/documents/view?file=${encodeURIComponent(d.file)}`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Uploaded documents are recognized via OCR and added to this client&apos;s in-memory index
        for the current server session; the recognized text is human-reviewable above and in the viewer.
      </p>
    </div>
  );
}
