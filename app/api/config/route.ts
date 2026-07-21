import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Effective runtime parameters (read-only) for the Settings screen.
export async function GET() {
  return NextResponse.json({
    llmModel: process.env.LLM_MODEL ?? "gpt-4o-mini",
    embedModel: process.env.EMBED_MODEL ?? "text-embedding-3-small",
    topK: Number(process.env.TOP_K ?? "5"),
    relevanceThreshold: Number(process.env.RELEVANCE_THRESHOLD ?? "0.28"),
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}
