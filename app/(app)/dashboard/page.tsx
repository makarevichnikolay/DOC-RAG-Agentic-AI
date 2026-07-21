"use client";

import Link from "next/link";
import { getSeed, SEEDS } from "@/lib/seeds";
import { roleLabel } from "@/lib/access";
import { useApp } from "../../providers";

export default function DashboardPage() {
  const app = useApp();
  const session = app.session;
  if (!session) return null;

  const seed = getSeed(app.clientId);
  const uploaded = app.uploads[app.clientId] ?? [];
  const docCount = seed.documents.length + uploaded.length;
  const openFlags = seed.flags.filter(
    (f) =>
      !app.confirmedFlags.includes(f.id) && !app.dismissedFlags.includes(f.id)
  );
  const openTasks = app.tasks.filter(
    (t) => t.clientId === app.clientId && t.status !== "done"
  );
  const deadlines = [...seed.deadlines].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return (
    <div>
      <div className="pagehead">
        <h1>Dashboard</h1>
        <span className="muted">
          {seed.client} · signed in as {session.name} ({roleLabel(session.role)})
        </span>
      </div>

      <div className="cardgrid">
        <div className="statcard">
          <div className="statnum">{docCount}</div>
          <div className="statlabel">Documents</div>
          <Link className="statlink" href="/documents">
            Open documents →
          </Link>
        </div>
        <div className="statcard">
          <div className="statnum">{openFlags.length}</div>
          <div className="statlabel">Open flags</div>
          <Link className="statlink" href="/flags">
            Review flags →
          </Link>
        </div>
        <div className="statcard">
          <div className="statnum">{openTasks.length}</div>
          <div className="statlabel">Open tasks</div>
          <Link className="statlink" href="/flags">
            Go to tasks →
          </Link>
        </div>
        {session.role === "admin" && (
          <div className="statcard">
            <div className="statnum">{SEEDS.length}</div>
            <div className="statlabel">Clients in portfolio</div>
            <Link className="statlink" href="/portfolio">
              Cross-client query →
            </Link>
          </div>
        )}
      </div>

      <div className="twocol">
        <div className="card">
          <div className="cardtitle">Upcoming deadlines</div>
          <div className="cardbody">
            {deadlines.map((d, i) => (
              <div className="deadline" key={i}>
                <span className="deadlinedate">{d.date}</span>
                <div>
                  <strong>{d.doc}:</strong>{" "}
                  <span className="muted">{d.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="cardtitle">Quick actions</div>
          <div className="cardbody">
            <div className="quickactions">
              <Link className="primarybtn" href="/ask">
                Ask about the contracts
              </Link>
              <Link className="qbtn" href="/flags">
                Review risk flags
              </Link>
              {session.role === "admin" && (
                <Link className="qbtn" href="/portfolio">
                  Portfolio query (all clients)
                </Link>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              {session.role === "analyst" &&
                "Find any clause with a citation and turn risk flags into tasks — for legal, operations and procurement."}
              {session.role === "admin" &&
                "Admin view: everything, plus the cross-client Portfolio and Evals panels."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
