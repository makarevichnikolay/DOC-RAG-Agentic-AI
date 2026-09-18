import { NextRequest, NextResponse } from "next/server";
import { getClientConfig } from "@/lib/clients";
import { discuss, type Turn } from "@/lib/conversation";

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

    return NextResponse.json(await discuss(clientId, turns, question.trim()));
  } catch (err: any) {
    console.error("[/api/discuss]", err);
    return NextResponse.json({ error: err?.message ?? "Discussion failed" }, { status: 500 });
  }
}
