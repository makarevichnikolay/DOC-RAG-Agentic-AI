"use client";

import { useMemo, useState } from "react";
import { getSeed } from "@/lib/seeds";
import { isViewOnly } from "@/lib/access";
import type { RegisterRow } from "@/lib/types";
import { useApp } from "../../providers";

type SortKey = keyof RegisterRow;

// Register: human-confirmed extracted terms (seed) with filter, sort and CSV export.
export default function RegisterPage() {
  const app = useApp();
  const session = app.session;
  const seed = getSeed(app.clientId);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("doc");
  const [sortAsc, setSortAsc] = useState(true);

  const viewOnly = session ? isViewOnly(session.role, "register") : false;

  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    const filtered = seed.register.filter(
      (r) =>
        !f ||
        [r.doc, r.term, r.law, r.parties, r.key].some((v) =>
          v.toLowerCase().includes(f)
        )
    );
    return [...filtered].sort((a, b) => {
      const cmp = a[sortKey].localeCompare(b[sortKey]);
      return sortAsc ? cmp : -cmp;
    });
  }, [seed.register, filter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["Document", "Term / renewal", "Governing law", "Parties", "Key clauses"];
    const lines = [
      header.map(esc).join(","),
      ...rows.map((r) => [r.doc, r.term, r.law, r.parties, r.key].map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${app.clientId}-register.csv`;
    a.click();
    URL.revokeObjectURL(url);
    app.log("export_register", `Register CSV exported (${rows.length} rows)`);
  }

  const cols: { key: SortKey; label: string }[] = [
    { key: "doc", label: "Document" },
    { key: "term", label: "Term / renewal" },
    { key: "law", label: "Governing law" },
    { key: "parties", label: "Parties" },
    { key: "key", label: "Key clauses" },
  ];

  return (
    <div>
      <div className="pagehead">
        <h1>Register</h1>
        <span className="chip">seed · human-confirmed</span>
        {viewOnly && <span className="chip warnchip">view only</span>}
        <span style={{ flex: 1 }} />
        {!viewOnly && (
          <button className="qbtn" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>

      <input
        type="text"
        placeholder="Filter by any field…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 10, maxWidth: 360, width: "100%" }}
      />

      <div className="tablecard">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="sortable"
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label} {sortKey === c.key ? (sortAsc ? "▲" : "▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.doc}</td>
                <td>{r.term}</td>
                <td>{r.law}</td>
                <td>{r.parties}</td>
                <td>{r.key}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No rows match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        The register holds facts confirmed by a human after auto-extraction
        (human-in-the-loop). In this demo it is seeded per client;{" "}
        {seed.client} has {seed.register.length} confirmed entries.
      </p>
    </div>
  );
}
