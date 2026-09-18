import { NextRequest, NextResponse } from "next/server";
import { queryPortfolio } from "@/lib/rag";
import { nowStamp, recordQuery } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cross-client portfolio query (Admin-only in the UI; mock auth, so no server enforcement in v1).
export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing 'question'." }, { status: 400 });
    }
    const results = await queryPortfolio(question);
    // One portfolio question fans out across every client, so it records one
    // event PER CLIENT. Collapsing it into a single event would make a
    // cross-client query look as cheap as a single-client one, and would hide
    // which tenant's index was the slow or refusing one.
    //
    // latencyMs is THIS client's own query (measured inside queryPortfolio), not
    // the whole fan-out. The clients are queried one after another, so charging
    // every event with the total elapsed time — which this used to do — reported
    // each tenant as N times slower than it was and pushed the Monitoring page's
    // p50/p95 to roughly N x the true worst case.
    for (const r of results) {
      await recordQuery({
        time: nowStamp(),
        clientId: r.clientId,
        surface: "portfolio",
        question,
        topScore: r.result?.topScore ?? 0,
        refused: r.result?.refused ?? false,
        refusedBy: r.result?.refusedBy,
        sources: r.result?.sources.length ?? 0,
        latencyMs: r.ms,
        error: r.error,
      });
    }
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[/api/portfolio]", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
