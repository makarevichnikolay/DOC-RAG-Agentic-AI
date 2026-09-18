"use client";

import { useCallback, useEffect, useState } from "react";
import { canAccess } from "@/lib/access";
import { getSeed } from "@/lib/seeds";
import type { MonitorSummary, QueryEvent } from "@/lib/monitor";
import { useApp } from "../../providers";

// Monitoring (Admin) — ONLINE metrics: what real users asked and what they got.
//
// Deliberately a different page from Inspector & Evals, because they answer
// different questions and mixing them would let a good score on one hide a bad
// score on the other:
//
//   Evals       14 golden questions, run on demand, graded. "Did I break it?"
//   Monitoring  every real query, ungraded, as it happens. "Is it working now?"
//
// The number that matters most here is the refusal SPLIT, not the refusal rate.
// A guardrail refusal (score below threshold, no model call) and a model refusal
// (model read the excerpts, found nothing) look identical to a user and need
// opposite fixes — see the header of lib/monitor.ts.

type Payload = {
  events: QueryEvent[];
  summary: MonitorSummary;
  threshold: number;
  nearBand: number;
  /** The row cap the API applied, and how many rows came back under it. */
  limit: number;
  returned: number;
  persistent: boolean;
  storeKind: string;
};

/**
 * Rows requested per load.
 *
 * The API's own ceiling (MAX_LIMIT in lib/monitor.ts), so the table shows as
 * much as the store retains. Left explicit rather than relying on the API's
 * DEFAULT_LIMIT of 50: the summary counts every retained event, and a table
 * silently truncated to 50 under a stat card reading "Queries recorded 200"
 * is the same lie parseLimit's own comment was written about.
 */
const ROW_LIMIT = 200;

function pct(n: number, of: number): string {
  if (of === 0) return "—";
  return `${Math.round((n / of) * 100)}%`;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

const SURFACE_LABEL: Record<QueryEvent["surface"], string> = {
  ask: "Ask",
  discuss: "Discussion",
  portfolio: "Portfolio",
};

export default function MonitoringPage() {
  const app = useApp();
  const session = app.session;
  const seed = getSeed(app.clientId);

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoped, setScoped] = useState(true);

  /**
   * The scope currently on screen, as a query string.
   *
   * Shared by the loader and by Clear, deliberately: the button sits under a
   * header that says which client is being shown, so it must delete exactly
   * that. Passing no scope would wipe every tenant's metrics.
   */
  const scopeQs = useCallback(
    () => (scoped ? `clientId=${encodeURIComponent(app.clientId)}` : "clientId=all"),
    [app.clientId, scoped]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/monitor?${scopeQs()}&limit=${ROW_LIMIT}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load metrics");
      setData(body as Payload);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scopeQs]);

  // Clear only what is on screen, and never claim success it did not get: the
  // DELETE response used to be discarded, so a failed clear still wrote a
  // "metrics cleared" line into the audit trail and re-rendered unchanged data.
  const clearMetrics = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/monitor?${scopeQs()}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to clear metrics");
      app.log(
        "monitor_reset",
        scoped ? `Monitoring metrics cleared for ${seed.client}` : "Monitoring metrics cleared (all clients)"
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }, [app, load, scopeQs, scoped, seed.client]);

  useEffect(() => {
    if (!session || !canAccess(session.role, "monitoring")) return;
    load();
  }, [load, session]);

  if (!session || !canAccess(session.role, "monitoring")) {
    return (
      <div className="errorbox">
        ⚠ Access denied — Monitoring is available to Partner / Admin only. Use
        “Switch role” in the top bar.
      </div>
    );
  }

  const s = data?.summary;

  // Refusals are split rather than totalled — see the header note.
  const cards = [
    { label: "Queries recorded", value: s ? String(s.total) : "—" },
    {
      label: "Refused",
      value: s ? `${pct(s.refused, s.total)}` : "—",
      hint: s ? `${s.refused} of ${s.total}` : undefined,
    },
    {
      label: "— by guardrail",
      value: s ? String(s.refusedByGuardrail) : "—",
      hint: "Score below threshold; no model call was made. Retrieval or threshold problem.",
    },
    {
      label: "— by model",
      value: s ? String(s.refusedByModel) : "—",
      hint: "Model read the excerpts and found no answer. Content problem, or a correct refusal.",
    },
    {
      label: "Latency p95",
      value: s ? ms(s.latencyP95) : "—",
      hint: s ? `median ${ms(s.latencyP50)}` : undefined,
    },
    {
      label: "Errors",
      value: s ? String(s.errors) : "—",
      hint: "Requests that threw instead of answering.",
    },
  ];

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Monitoring</h1>
          <p className="muted">
            Real queries as they happen — separate from Inspector &amp; Evals, which
            grades a fixed set of golden questions on demand. Evals tell you whether
            a change broke something; this tells you what users are actually hitting.
          </p>
        </div>
      </div>

      {/* The honesty line. A monitoring page that quietly loses data is worse
          than one that says so — and this store is per server process. */}
      <div className="archnote" style={{ marginBottom: 12 }}>
        <b>In-process, not persisted.</b> Metrics live in the server&apos;s memory and
        reset when it restarts, mirroring <code>VECTOR_STORE=memory</code>. The store
        is capped at the 500 most recent queries.{" "}
        {data?.storeKind === "postgres" && (
          <>
            <b>Note:</b> <code>VECTOR_STORE=postgres</code> is set, but the Postgres
            metric backend is not implemented yet — this is still in-process.
          </>
        )}
        <br />
        <b>Questions are recorded on every screen</b>, including Discussion. What
        stays browser-only there is the running transcript, not the individual
        questions. Set <code>MONITOR_STORE_QUESTIONS=off</code> to record metrics
        without any question text.
      </div>

      <div className="klabel" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{scoped ? `${seed.client} only` : "All clients"}</span>
        <button className="smallbtn" onClick={() => setScoped((v) => !v)}>
          {scoped ? "Show all clients" : "Scope to current client"}
        </button>
        <button className="smallbtn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          className="smallbtn"
          onClick={clearMetrics}
          disabled={loading}
          title={
            scoped
              ? `Delete the recorded metrics for ${seed.client} only`
              : "Delete the recorded metrics for every client"
          }
        >
          {scoped ? `Clear ${seed.client}` : "Clear all clients"}
        </button>
      </div>

      {error && <div className="errorbox" style={{ marginBottom: 8 }}>⚠ {error}</div>}

      <div className="cardgrid" style={{ marginBottom: 12 }}>
        {cards.map((c) => (
          <div className="statcard" key={c.label} title={c.hint}>
            <div className="statnum">{c.value}</div>
            <div className="statlabel">{c.label}</div>
          </div>
        ))}
      </div>

      {s && s.total > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Mean top score <b>{s.avgTopScore.toFixed(3)}</b> against a guardrail
          threshold of <b>{data?.threshold}</b>.{" "}
          <b>{s.nearThreshold}</b> quer{s.nearThreshold === 1 ? "y" : "ies"} scored
          within {data?.nearBand} of it — those passed the guardrail only just, and
          are the ones to watch if you retune the threshold.
        </p>
      )}

      <div className="klabel" style={{ marginTop: 14 }}>
        Recent queries
        {data && s && (
          <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
            — showing {data.returned} of {s.total}
            {data.returned < s.total && ` (newest ${data.limit}; the store keeps 500)`}
          </span>
        )}
      </div>
      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Screen</th>
              <th>Question</th>
              <th>Top score</th>
              <th>Outcome</th>
              <th>Sources</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {data?.events.map((e, i) => (
              <tr key={i}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{e.time}</td>
                <td>{SURFACE_LABEL[e.surface]}</td>
                <td>
                  {e.question ?? (
                    <span className="muted" title="MONITOR_STORE_QUESTIONS=off — metrics only.">
                      not recorded
                    </span>
                  )}
                  {/* The score belongs to the rewritten question, not the typed
                      one, so showing only what was typed would misattribute it. */}
                  {e.searchedFor && (
                    <div
                      className="muted"
                      style={{ fontSize: 11, marginTop: 2 }}
                      title="Follow-ups are rewritten to stand alone before searching. This is what retrieval ran on, and what Top score refers to."
                    >
                      searched: {e.searchedFor}
                    </div>
                  )}
                </td>
                <td>{e.error ? "—" : e.topScore.toFixed(3)}</td>
                <td>
                  {e.error ? (
                    <span className="chip failchip" title={e.error}>error</span>
                  ) : e.refused ? (
                    <span
                      className="chip warnchip"
                      title={
                        e.refusedBy === "guardrail"
                          ? "Best score fell below the threshold — no model call was made."
                          : "The model read the excerpts and found no answer in them."
                      }
                    >
                      refused · {e.refusedBy ?? "unknown"}
                    </span>
                  ) : (
                    <span className="chip okchip">answered</span>
                  )}
                </td>
                <td>{e.sources}</td>
                <td>{ms(e.latencyMs)}</td>
              </tr>
            ))}
            {!loading && data?.events.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No queries recorded yet. Ask a question on the Ask screen, then come back.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
