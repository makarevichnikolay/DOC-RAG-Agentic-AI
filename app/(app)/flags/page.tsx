"use client";

import { useState } from "react";
import { getSeed } from "@/lib/seeds";
import type { TaskItem, TaskStatus } from "@/lib/types";
import { useApp } from "../../providers";

// Flags & Tasks — the operational human-in-the-loop flow:
// seed flags → human confirms → task is created (local state) → optional
// simulated "Generate standard doc (T-1)" placeholder document.
export default function FlagsPage() {
  const app = useApp();
  const seed = getSeed(app.clientId);
  const [docTask, setDocTask] = useState<TaskItem | null>(null);

  // Seed flags + flags auto-detected from documents uploaded this session.
  const clientFlags = [...seed.flags, ...(app.uploadedFlags[app.clientId] ?? [])];

  const openFlags = clientFlags.filter(
    (f) =>
      !app.confirmedFlags.includes(f.id) && !app.dismissedFlags.includes(f.id)
  );
  const handledFlags = clientFlags.filter(
    (f) =>
      app.confirmedFlags.includes(f.id) || app.dismissedFlags.includes(f.id)
  );
  const tasks = app.tasks.filter((t) => t.clientId === app.clientId);

  function confirm(flagId: string) {
    const flag = clientFlags.find((f) => f.id === flagId);
    if (!flag) return;
    app.confirmFlag({
      flagId,
      clientId: app.clientId,
      title: `${flag.doc}: ${flag.text.length > 90 ? flag.text.slice(0, 88) + "…" : flag.text}`,
      source: `${flag.doc} [${flag.cite}]`,
    });
  }

  function placeholderDoc(task: TaskItem): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      "STANDARD DOCUMENT (T-1) — DRAFT FOR REVIEW",
      "",
      `Client:  ${seed.client}`,
      `Task:    ${task.title}`,
      `Source:  ${task.source}`,
      `Date:    ${today}`,
      "",
      "RE: NOTICE PURSUANT TO THE REFERENCED AGREEMENT",
      "",
      "Dear Counterparty,",
      "",
      "We refer to the agreement identified above. In accordance with its terms,",
      "we hereby provide notice of our position with respect to the flagged",
      "provision. [The operative paragraphs would be generated here from the",
      "confirmed register facts and the applicable clause.]",
      "",
      "This draft was produced by the T-1 standard-document generator of the",
      "Contract Intelligence demo. It is a placeholder: in production the",
      "letter is assembled from confirmed register data and firm templates,",
      "then routed for attorney review before sending.",
      "",
      "Sincerely,",
      `${app.session?.name ?? "Demo User"}`,
      `${seed.client} — via Contract Intelligence`,
      "",
      "[Simulated output — not legal advice.]",
    ].join("\n");
  }

  function downloadDoc(task: TaskItem) {
    const blob = new Blob([placeholderDoc(task)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `T-1_${task.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statuses: TaskStatus[] = ["open", "in_progress", "done"];

  return (
    <div>
      <div className="pagehead">
        <h1>Flags &amp; Tasks</h1>
        <span className="chip">seed + local state</span>
        <span className="muted">
          {seed.client} · the system proposes, a human confirms.
        </span>
      </div>

      <div className="klabel">Open flags ({openFlags.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {openFlags.map((f) => (
          <div className={`flag ${f.level}`} key={f.id}>
            <span>{f.level === "warn" ? "⏰" : f.level === "danger" ? "⚠" : "🛡"}</span>
            <div style={{ fontSize: 13, flex: 1 }}>
              <strong>{f.doc}:</strong> {f.text}{" "}
              <span className="muted">[{f.cite}]</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="primarybtn smallbtn" onClick={() => confirm(f.id)}>
                Confirm → task
              </button>
              <button
                className="qbtn smallbtn"
                onClick={() => app.dismissFlag(f.id, `Flag dismissed: ${f.doc} [${f.cite}]`)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
        {openFlags.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            No open flags — all seed flags for this client have been handled in
            this session.
          </div>
        )}
      </div>

      {handledFlags.length > 0 && (
        <>
          <div className="klabel">Handled in this session</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            {handledFlags.map((f) => (
              <div className="flag handled" key={f.id}>
                <span>{app.confirmedFlags.includes(f.id) ? "✓" : "✕"}</span>
                <div style={{ fontSize: 13 }}>
                  <strong>{f.doc}:</strong> {f.text}{" "}
                  <span className="chip">
                    {app.confirmedFlags.includes(f.id) ? "confirmed → task" : "dismissed"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="klabel">Tasks ({tasks.length})</div>
      <div className="tablecard" style={{ marginBottom: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Source</th>
              <th>Created</th>
              <th>Status</th>
              <th>Standard doc</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td className="muted">{t.source}</td>
                <td>{t.createdAt}</td>
                <td>
                  <select
                    value={t.status}
                    onChange={(e) =>
                      app.updateTaskStatus(t.id, e.target.value as TaskStatus)
                    }
                    className="statusselect"
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="qbtn smallbtn"
                    onClick={() => {
                      setDocTask(t);
                      app.markDocGenerated(t.id);
                      app.log("generate_doc", `T-1 placeholder generated for: ${t.title}`);
                    }}
                  >
                    {t.docGenerated ? "View doc (T-1)" : "Generate standard doc (T-1)"}
                  </button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No tasks yet — confirm a flag above to create one
                  (human-in-the-loop).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {docTask && (
        <div className="modalback" onClick={() => setDocTask(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="cardtitle">
              Standard document (T-1) — simulated
              <span style={{ flex: 1 }} />
              <button className="qbtn smallbtn" onClick={() => setDocTask(null)}>
                Close
              </button>
            </div>
            <pre className="docview modaldoc">{placeholderDoc(docTask)}</pre>
            <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
              <button className="primarybtn" onClick={() => downloadDoc(docTask)}>
                Download .txt
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        Flags are seeded per client; confirming one creates a task in local
        session state. “Generate standard doc (T-1)” produces a placeholder
        document — in production it would be assembled from confirmed register
        facts and firm templates.
      </p>
    </div>
  );
}
