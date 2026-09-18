import { NextRequest, NextResponse } from "next/server";
import { getClientConfig } from "@/lib/clients";
import { discuss, type Turn } from "@/lib/conversation";
import { nowStamp, recordQuery } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two model calls (rewrite, then answer) with an embedding pass between them —
// strictly more work than /api/query, which already claims 60s. Without this the
// platform default applies (10s on Vercel Hobby, the documented deploy target)
// and every follow-up 504s in production while passing locally.
export const maxDuration = 60;

// Bounded so a client cannot push an unbounded transcript through the rewriter.
const MAX_TURNS = 40;
const MAX_QUESTION = 2000;

export async function POST(req: NextRequest) {
  try {
    const { clientId, history, question } = (await req.json()) as {
      clientId?: string;
      history?: Turn[];
      question?: string;
    };

    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Missing 'question'." }, { status: 400 });
    }
    if (question.length > MAX_QUESTION) {
      return NextResponse.json({ error: "Question too long." }, { status: 400 });
    }
    if (!clientId || !getClientConfig(clientId)) {
      return NextResponse.json({ error: "Unknown client." }, { status: 400 });
    }

    // The transcript is client-held (it dies when the user leaves the page), so
    // validate its shape here rather than trusting it.
    const turns: Turn[] = Array.isArray(history)
      ? history
          .filter(
            (t): t is Turn =>
              !!t &&
              (t.role === "user" || t.role === "assistant") &&
              typeof t.content === "string"
          )
          .slice(-MAX_TURNS)
      : [];

    const startedAt = Date.now();
    // The question is recorded like any other surface's. Two fields, not one,
    // because a follow-up is REWRITTEN before it is searched (lib/conversation.ts):
    // the user types "how much notice to stop it?" and retrieval runs on "how much
    // notice is required to stop the Cascade agreement auto-renewing". Recording
    // only the typed text would attach a score of 0.41 to a question that was
    // never searched, which is exactly the sort of misleading record that sends an
    // operator hunting for a retrieval bug that isn't there.
    try {
      const out = await discuss(clientId, turns, question.trim());
      await recordQuery({
        time: nowStamp(),
        clientId,
        surface: "discuss",
        question: question.trim(),
        searchedFor: out.rewritten ? out.searchedFor : undefined,
        topScore: out.result.topScore,
        refused: out.result.refused,
        refusedBy: out.result.refusedBy,
        sources: out.result.sources.length,
        latencyMs: Date.now() - startedAt,
      });
      return NextResponse.json(out);
    } catch (err: any) {
      await recordQuery({
        time: nowStamp(),
        clientId,
        surface: "discuss",
        question: question.trim(),
        topScore: 0,
        refused: false,
        sources: 0,
        latencyMs: Date.now() - startedAt,
        error: err?.message ?? "Discussion failed",
      });
      throw err;
    }
  } catch (err: any) {
    console.error("[/api/discuss]", err);
    return NextResponse.json({ error: err?.message ?? "Discussion failed" }, { status: 500 });
  }
}
