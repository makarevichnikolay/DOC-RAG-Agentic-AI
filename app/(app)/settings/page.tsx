"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccess } from "@/lib/access";
import { useApp } from "../../providers";

type Config = {
  llmProvider: string;
  llmModel: string;
  embedProvider: string;
  embedModel: string;
  vectorStore: string;
  vectorStoreTarget: string | null;
  topK: number;
  relevanceThreshold: number;
  thresholdSource: string;
  apiKeyConfigured: boolean;
  missingKeys: string[];
};

// Settings (Admin): effective runtime parameters (read-only) + session audit log.
export default function SettingsPage() {
  const app = useApp();
  const router = useRouter();
  const session = app.session;
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then(async (r) => {
        const data = await r.json();
        // The route answers 400 with a readable message for an invalid provider
        // value. Without this check `config` would be an object of undefineds
        // and the table below would throw on missingKeys.join().
        if (!r.ok) throw new Error(data.error || "Failed to load configuration");
        setConfig(data as Config);
      })
      .catch((e) => setConfigError(e.message));
  }, []);

  if (!session || !canAccess(session.role, "settings")) {
    return (
      <div className="errorbox">
        ⚠ Access denied — Settings is available to Partner / Admin only. Use
        “Switch role” in the top bar.
      </div>
    );
  }

  const rows: [string, string][] = config
    ? [
        ["LLM provider (LLM_PROVIDER)", config.llmProvider],
        ["LLM model", config.llmModel],
        ["Embedding provider (EMBED_PROVIDER)", config.embedProvider],
        ["Embedding model", config.embedModel],
        [
          "Vector store (VECTOR_STORE)",
          config.vectorStore === "postgres"
            ? `postgres + pgvector — ${config.vectorStoreTarget} (persisted)`
            : "in-memory (rebuilt on restart)",
        ],
        ["TOP_K (retrieved chunks)", String(config.topK)],
        [
          "Relevance threshold (guardrail)",
          `${config.relevanceThreshold} (${config.thresholdSource})`,
        ],
        [
          "API keys",
          config.apiKeyConfigured
            ? "configured"
            : `NOT configured — live queries will fail (missing: ${config.missingKeys.join(", ")})`,
        ],
      ]
    : [];

  return (
    <div>
      <div className="pagehead">
        <h1>Settings</h1>
        <span className="chip">read-only in v1</span>
      </div>

      <div className="twocol">
        <div className="card">
          <div className="cardtitle">Runtime parameters</div>
          <div className="cardbody">
            {configError && <div className="errorbox">⚠ {configError}</div>}
            {!config && !configError && <span className="muted">Loading…</span>}
            {config && (
              <table>
                <tbody>
                  {rows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted" style={{ width: "55%" }}>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Values come from environment variables (.env.local). Editing from
              the UI is a next-iteration item. Reminder: the demo is{" "}
              <strong>English only</strong> — UI, prompts, data and answers.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="cardtitle">Session</div>
          <div className="cardbody">
            <p style={{ fontSize: 13, marginTop: 0 }}>
              Signed in as <strong>{session.name}</strong>. Mock auth: the
              session lives in a browser cookie; there is no user database in
              v1.
            </p>
            <button
              className="qbtn"
              onClick={() => {
                app.signOut();
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="klabel" style={{ marginTop: 18 }}>
        Audit log <span className="chip">session memory · mock</span>
      </div>
      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {app.audit.map((e, i) => (
              <tr key={i}>
                <td className="muted">{e.time}</td>
                <td>{e.user}</td>
                <td className="muted">{e.role}</td>
                <td>{e.action}</td>
                <td className="muted">{e.detail}</td>
              </tr>
            ))}
            {app.audit.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No events yet in this session.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
