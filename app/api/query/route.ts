import { NextRequest, NextResponse } from "next/server";
import { queryContracts } from "@/lib/rag";
import { getClientConfig } from "@/lib/clients";
import { nowStamp, recordQuery } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { question, clientId } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing 'question'." }, { status: 400 });
    }
    const id =
      typeof clientId === "string" && clientId ? clientId : "northwind-logistics";
    if (!getClientConfig(id)) {
      return NextResponse.json({ error: `Unknown client '${id}'.` }, { status: 400 });
    }
    // Timed around the whole pipeline — retrieval, guardrail and the model call —
    // because that is the latency the user actually waits through.
    const startedAt = Date.now();
    try {
      const result = await queryContracts(id, question);
      await recordQuery({
        time: nowStamp(),
        clientId: id,
        surface: "ask",
        question,
        topScore: result.topScore,
        refused: result.refused,
        refusedBy: result.refusedBy,
        sources: result.sources.length,
        latencyMs: Date.now() - startedAt,
      });
      return NextResponse.json(result);
    } catch (err: any) {
      // A failed query is the most interesting kind, so record it before
      // rethrowing to the handler below.
      await recordQuery({
        time: nowStamp(),
        clientId: id,
        surface: "ask",
        question,
        topScore: 0,
        refused: false,
        sources: 0,
        latencyMs: Date.now() - startedAt,
        error: err?.message ?? "Internal error",
      });
      throw err;
    }
  } catch (err: any) {
    console.error("[/api/query]", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
