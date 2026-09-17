#!/usr/bin/env node
// Run the golden-set evals from the terminal against a running dev server.
//
//   npm run dev                 # in one shell
//   npm run evals               # all clients
//   npm run evals -- --no-judge # skip grading (halves the LLM calls, see below)
//
// NOTE: --no-judge does NOT make the run free. Every question still goes
// through the real pipeline, and answering it is itself one LLM call. It skips
// the second call per question — the grading — so it roughly halves the cost.
// Only a question the guardrail refuses costs nothing, because no answer is
// generated for it.
//
// Exits non-zero when anything fails, so it can gate a commit or CI step.

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const judge = !process.argv.includes("--no-judge");
const only = process.argv.find((a) => a.startsWith("--client="))?.split("=")[1];
// Isolation alone: reads the stores, calls no model, costs nothing.
const isolationOnly = process.argv.includes("--isolation");

const clients = only ? [only] : ["northwind-logistics", "blue-harbor-retail"];
let failed = 0;

for (const clientId of clients) {
  process.stdout.write(`\n=== ${clientId} ===\n`);
  let run;
  try {
    const res = await fetch(`${BASE}/api/evals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, judge, isolationOnly }),
    });
    // res.ok first: a proxy timeout returns HTML, and parsing that as JSON
    // reports "Unexpected token '<'" instead of what actually went wrong.
    if (!res.ok) {
      const body = await res.text();
      let message = `HTTP ${res.status}`;
      try { message = JSON.parse(body).error ?? message; }
      catch { if (res.status === 504 || res.status === 502) message += " — the run timed out"; }
      throw new Error(message);
    }
    run = await res.json();
  } catch (err) {
    console.error(`  could not run: ${err.message}`);
    console.error(`  (is the dev server up at ${BASE}?)`);
    failed++;
    continue;
  }

  if (isolationOnly) {
    const i = run.isolation;
    console.log(`  isolation: ${i.clean ? `OK — all ${i.chunksChecked} stored chunks belong to this client` : `LEAK — foreign files: ${i.foreignFiles.join(", ")}`}`);
    if (!i.clean) failed++;
    continue;
  }

  for (const r of run.results) {
    const flags = [
      r.error ? `ERROR ${r.error}` : null,
      // Name the failing HALF first — it is what decides where to look.
      r.retrieval && !r.retrieval.found
        ? `retrieval MISS (${Math.round(r.retrieval.coverage * 100)}% — missing: ${r.retrieval.missing.join(", ")})`
        : null,
      !r.refusalCorrect ? (r.isProbe ? "probe not refused" : "wrongly refused") : null,
      !r.citationsValid ? "bad citation" : null,
      r.correctDocsCited === false ? "wrong document" : null,
      r.correctness && r.correctness !== "correct" ? r.correctness : null,
      r.faithful === false ? "unfaithful" : null,
    ].filter(Boolean);
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.q.slice(0, 62).padEnd(62)} ${flags.join(" · ")}`);
    // On a failure the grade alone ("partial") does not say what was missing.
    // The judge already wrote its reasoning; printing it is what turns the
    // report into something you can act on without re-running anything.
    if (!r.pass && r.judgeNote) console.log(`          judge: ${r.judgeNote}`);
    if (!r.pass) failed++;
  }

  const s = run.summary;
  const pct = (v) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  console.log(`  ---`);
  console.log(`  ${s.passed}/${s.total} passed · refusal ${pct(s.refusalAccuracy)} · retrieval recall ${pct(s.retrievalRecall)} · citations ${pct(s.citationValidity)} · right doc ${pct(s.correctDocRate)}`);
  console.log(`  isolation: ${run.isolation.clean ? `OK (${run.isolation.chunksChecked} chunks, all owned by this client)` : `LEAK — foreign files: ${run.isolation.foreignFiles.join(", ")}`}`);
  if (!run.isolation.clean) failed++;
  if (run.judged) console.log(`  correct ${s.correctness.correct} / partial ${s.correctness.partial} / incorrect ${s.correctness.incorrect} · faithful ${pct(s.faithfulness)}`);
  // An ungraded question still passes its deterministic checks, so say so
  // rather than letting a judge outage read as a clean run.
  if (s.ungraded) console.log(`  WARNING: ${s.ungraded} question(s) were NOT graded — the pass rate above is not a quality measurement.`);
  console.log(`  avg ${s.avgMs}ms · avg context ${s.avgContextChars} chars · avg top score ${s.avgTopScore.toFixed(3)}`);
  console.log(`  config: ${Object.entries(run.config).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
}

console.log(failed ? `\n${failed} failing check(s).` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
