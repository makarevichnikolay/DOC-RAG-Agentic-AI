import { NextRequest, NextResponse } from "next/server";
import { getClientConfig } from "@/lib/clients";
import {
  metricStore,
  parseLimit,
  relevanceThresholdForDisplay,
  NEAR_THRESHOLD_BAND,
} from "@/lib/monitor";
import { vectorStoreKind } from "@/lib/vector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reads an in-process array — no model call, no embedding, no database.
export const maxDuration = 10;

// NO AUTH CHECK, matching the rest of this demo's API routes — the login is
// mocked, so there is no session to enforce server-side. Flag it louder here
// than anywhere else, because this is the only route that hands back text REAL
// USERS typed: `GET ?clientId=all` returns every recorded question verbatim —
// Ask, Portfolio AND Discussion — across all tenants, to anything that can reach
// the host, and DELETE destroys the collected metrics with no confirmation. The
// only mitigation is MONITOR_STORE_QUESTIONS=off, which keeps metrics without
// text, and that is a blunt switch rather than access control. Put this behind
// real auth (and DELETE behind an admin role) before it runs anywhere public.

/**
 * Parse ?clientId. "all" and an absent param both mean cross-client; an unknown
 * id is a client error, because silently returning nothing would look like "no
 * traffic" rather than "you asked for a client that isn't there".
 *
 * Returns the id, undefined for cross-client, or an error response to send back.
 */
function scopeFrom(url: URL): { clientId?: string; error?: NextResponse } {
  const raw = url.searchParams.get("clientId");
  if (!raw || raw === "all") return {};
  if (!getClientConfig(raw)) {
    return { error: NextResponse.json({ error: `Unknown client '${raw}'.` }, { status: 400 }) };
  }
  return { clientId: raw };
}

/** Recent real queries + their summary. Admin-only in the UI (mock auth). */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const scope = scopeFrom(url);
    if (scope.error) return scope.error;
    const clientId = scope.clientId;

    const limit = parseLimit(url.searchParams.get("limit"));

    const store = metricStore();
    const [events, summary] = await Promise.all([
      store.recent({ clientId, limit }),
      store.summary({ clientId }),
    ]);

    return NextResponse.json({
      events,
      summary,
      // The UI states these rather than hardcoding them, so the page cannot
      // drift from the running configuration the way the architecture page did.
      threshold: relevanceThresholdForDisplay(),
      nearBand: NEAR_THRESHOLD_BAND,
      // `events` is capped by ?limit while `summary` covers everything retained,
      // so the page can say "showing N of M" instead of quietly implying that the
      // rows on screen are all there is.
      limit,
      returned: events.length,
      persistent: false,
      storeKind: vectorStoreKind(),
    });
  } catch (err: any) {
    console.error("[/api/monitor]", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/**
 * Clear collected metrics. Useful before a demo run.
 *
 * Scoped by ?clientId, for the same reason GET is: the page can be showing one
 * tenant, and a button on that page must not delete another tenant's data.
 */
export async function DELETE(req: NextRequest) {
  try {
    const scope = scopeFrom(new URL(req.url));
    if (scope.error) return scope.error;
    await metricStore().clear({ clientId: scope.clientId });
    return NextResponse.json({ ok: true, clientId: scope.clientId ?? null });
  } catch (err: any) {
    console.error("[/api/monitor]", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
