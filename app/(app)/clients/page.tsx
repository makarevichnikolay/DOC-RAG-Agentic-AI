"use client";

import { useRouter } from "next/navigation";
import { SEEDS } from "@/lib/seeds";
import { useApp } from "../../providers";

export default function ClientsPage() {
  const app = useApp();
  const router = useRouter();

  return (
    <div>
      <div className="pagehead">
        <h1>Clients</h1>
        <span className="muted">
          Selecting a client makes it the active context — retrieval and all
          screens are scoped to it (isolation).
        </span>
      </div>

      <div className="cardgrid">
        {SEEDS.map((s) => {
          const uploaded = app.uploads[s.clientId] ?? [];
          const active = app.clientId === s.clientId;
          return (
            <div className={`card clientcard ${active ? "activeclient" : ""}`} key={s.clientId}>
              <div className="cardbody">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h2 style={{ margin: 0 }}>{s.client}</h2>
                  {active && <span className="chip okchip">active</span>}
                </div>
                <div className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
                  {s.industry} · {s.documents.length + uploaded.length} documents ·{" "}
                  {s.flags.length} seed flags
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!active && (
                    <button
                      className="primarybtn"
                      onClick={() => app.setClient(s.clientId)}
                    >
                      Set active
                    </button>
                  )}
                  <button
                    className="qbtn"
                    onClick={() => {
                      app.setClient(s.clientId);
                      router.push("/documents");
                    }}
                  >
                    View documents
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Each client has its own vector index — a query for one client physically
        cannot retrieve another client&apos;s chunks.
      </p>
    </div>
  );
}
