import { NextRequest, NextResponse } from "next/server";
import { checkIsolation, runEvals } from "@/lib/evals";
import { getClientConfig } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The set is up to 9 questions x (retrieval + answer + judge). Bounded
// concurrency keeps it well inside this, but a cold vector store re-indexes
// first and that is the slow part.
export const maxDuration = 300;

// No auth check, matching the rest of this demo's API routes — the login is
// mocked, so there is no session to enforce server-side. Worth flagging louder
// here than elsewhere: /api/query costs ONE model call per request, while this
// one fans out to roughly two per golden question (~18 for the larger client),
// and it is reachable by anything that can reach the host. Put it behind real
// auth and a rate limit before this runs anywhere public.

export async function POST(req: NextRequest) {
  try {
    const { clientId, judge, isolationOnly } = (await req.json()) as {
      clientId?: string;
      judge?: boolean;
      isolationOnly?: boolean;
    };
    if (!clientId) {
      return NextResponse.json({ error: "Missing clientId." }, { status: 400 });
    }
    // Isolation reads what is stored; it asks no model and embeds nothing, so
    // it can be checked on its own without spending anything.
    if (isolationOnly) {
      const cfg = getClientConfig(clientId);
      if (!cfg) return NextResponse.json({ error: "Unknown client." }, { status: 400 });
      return NextResponse.json({ clientId, isolation: await checkIsolation(cfg) });
    }
    // Validate here rather than letting runEvals throw, so an unknown client is
    // a 400 on both paths instead of 400 on isolationOnly and 500 here.
    if (!getClientConfig(clientId)) {
      return NextResponse.json({ error: "Unknown client." }, { status: 400 });
    }
    const run = await runEvals(clientId, judge !== false);
    return NextResponse.json(run);
  } catch (err: any) {
    console.error("[/api/evals]", err);
    return NextResponse.json({ error: err?.message ?? "Eval run failed" }, { status: 500 });
  }
}
