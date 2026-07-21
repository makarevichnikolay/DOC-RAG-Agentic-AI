"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES } from "@/lib/access";
import type { Role } from "@/lib/types";
import { useApp } from "../providers";

// Mock login: pick a role + demo name, no password. "Switch role" from the
// top bar routes back here at any time.
export default function LoginPage() {
  const { signIn, session } = useApp();
  const router = useRouter();
  const [role, setRole] = useState<Role>("analyst");
  const [name, setName] = useState<string>(ROLES[0].defaultName);
  const [touched, setTouched] = useState(false);

  function pick(r: Role) {
    setRole(r);
    if (!touched) {
      setName(ROLES.find((x) => x.id === r)?.defaultName ?? "");
    }
  }

  function submit() {
    const finalName =
      name.trim() || ROLES.find((x) => x.id === role)?.defaultName || "Demo User";
    signIn(role, finalName);
    router.push("/dashboard");
  }

  return (
    <div className="loginwrap">
      <div className="logincard">
        <div className="loginbrand">
          <div className="loginlogo">CI</div>
          <div>
            <h1>Contract Intelligence</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              Demo — real RAG over real contracts
            </div>
          </div>
        </div>

        <div className="klabel" style={{ marginTop: 18 }}>
          1 · Choose a role
        </div>
        <div className="rolegrid">
          {ROLES.map((r) => (
            <button
              key={r.id}
              className={`rolecard ${role === r.id ? "selected" : ""}`}
              onClick={() => pick(r.id)}
            >
              <div className="rolename">{r.label}</div>
              <div className="roleblurb">{r.blurb}</div>
            </button>
          ))}
        </div>

        <div className="klabel" style={{ marginTop: 16 }}>
          2 · Demo name
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setTouched(true);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your demo name"
        />

        <button className="primarybtn loginbtn" onClick={submit}>
          Sign in
        </button>

        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Mock login — no password, the session lives in your browser.
          {session ? ` Currently signed in as ${session.name}; signing in again switches the role.` : ""}
        </p>
      </div>
    </div>
  );
}
