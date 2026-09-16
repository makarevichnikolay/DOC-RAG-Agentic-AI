import { NextRequest, NextResponse } from "next/server";
import { runEvals } from "@/lib/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The set is up to 9 questions x (retrieval + answer + judge). Bounded
// concurrency keeps it well inside this, but a cold vector store re-indexes
// first and that is the slow part.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { clientId, judge } = (await req.json()) as { clientId?: string; judge?: boolean };
    if (!clientId) {
      return NextResponse.json({ error: "Missing clientId." }, { status: 400 });
    }
    const run = await runEvals(clientId, judge !== false);
    return NextResponse.json(run);
  } catch (err: any) {
    console.error("[/api/evals]", err);
    return NextResponse.json({ error: err?.message ?? "Eval run failed" }, { status: 500 });
  }
}
