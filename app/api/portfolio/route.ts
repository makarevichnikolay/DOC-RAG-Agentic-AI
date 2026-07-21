import { NextRequest, NextResponse } from "next/server";
import { queryPortfolio } from "@/lib/rag";

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
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[/api/portfolio]", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
