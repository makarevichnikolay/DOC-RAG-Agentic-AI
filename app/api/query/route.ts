import { NextRequest, NextResponse } from "next/server";
import { queryContracts } from "@/lib/rag";
import { getClientConfig } from "@/lib/clients";

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
    const result = await queryContracts(id, question);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[/api/query]", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
