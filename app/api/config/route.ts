import { NextResponse } from "next/server";
import {
  embedModelName,
  embedProvider,
  hasKey,
  keyEnvName,
  llmModel,
  llmProvider,
  relevanceThreshold,
  thresholdOverrideInvalid,
} from "@/lib/providers";
import { connectionString, vectorStoreKind } from "@/lib/vector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** host/database of DATABASE_URL, with any credentials stripped. */
function describeDatabase(): string {
  try {
    const url = new URL(connectionString());
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "not configured";
  }
}

// Effective runtime parameters (read-only) for the Settings screen.
export async function GET() {
  try {
    const llm = llmProvider();
    const embed = embedProvider();
    const store = vectorStoreKind();

    // Only the providers actually in use need a key ("local" needs none).
    const missing: string[] = [];
    for (const provider of [llm, embed] as const) {
      const envName = keyEnvName(provider);
      if (envName && !hasKey(provider)) missing.push(envName);
    }

    return NextResponse.json({
      llmProvider: llm,
      llmModel: llmModel(),
      embedProvider: embed,
      embedModel: embedModelName(),
      vectorStore: store,
      // Never expose credentials: show host/database only, never user:password.
      vectorStoreTarget: store === "postgres" ? describeDatabase() : null,
      topK: Number(process.env.TOP_K ?? "5"),
      relevanceThreshold: relevanceThreshold(),
      thresholdSource: thresholdOverrideInvalid()
        ? `RELEVANCE_THRESHOLD is not a number — ignored, using the ${embed} default`
        : process.env.RELEVANCE_THRESHOLD?.trim()
          ? "env override"
          : `default for ${embed}`,
      apiKeyConfigured: missing.length === 0,
      missingKeys: Array.from(new Set(missing)),
    });
  } catch (err: any) {
    // An invalid provider value should surface as a readable message, not a 500.
    return NextResponse.json({ error: err?.message ?? "Invalid configuration" }, { status: 400 });
  }
}
