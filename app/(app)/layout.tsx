"use client";

// App shell: top bar (product, client selector, user + role, switch role)
// and the role-filtered side menu. Guards all app routes behind the mock session.

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV, canAccess, roleLabel } from "@/lib/access";
import { SEEDS } from "@/lib/seeds";
import { useApp } from "../providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const session = app.session;

  useEffect(() => {
    if (app.ready && !session) router.replace("/login");
  }, [app.ready, session, router]);

  if (!app.ready || !session) {
    return (
      <div className="fullcenter">
        <span className="muted">Checking session…</span>
      </div>
    );
  }

  const items = NAV.filter((n) => canAccess(session.role, n.id));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandlogo">CI</span>
          <span className="brandname">Contract Intelligence</span>
          <span className="chip protochip">Demo</span>
        </div>

        <div className="topclient">
          <span className="klabel" style={{ margin: 0 }}>
            Client
          </span>
          <select
            value={app.clientId}
            onChange={(e) => app.setClient(e.target.value)}
            className="clientselect"
          >
            {SEEDS.map((s) => (
              <option key={s.clientId} value={s.clientId}>
                {s.client}
              </option>
            ))}
          </select>
        </div>

        <div className="topuser">
          <span className="userchip">
            {session.name} · {roleLabel(session.role)}
          </span>
          <button className="qbtn" onClick={() => router.push("/login")}>
            Switch role
          </button>
        </div>
      </header>

      <div className="shellbody">
        <nav className="sidebar">
          {items.map((n) => {
            const active =
              pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.id}
                href={n.href}
                className={`navitem ${active ? "active" : ""}`}
              >
                <span className="navicon">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
          <div className="sidefoot muted">
            English only · facts from documents, not legal advice
          </div>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
