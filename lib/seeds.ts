// Client-safe seed data (per-client registers, flags, presets, goldens).
// The seed is "human-confirmed" demo data; live Q&A runs via RAG on the server.

import northwind from "@/data/northwind-logistics/seed.json";
import blueharbor from "@/data/blue-harbor-retail/seed.json";
import type { ClientSeed } from "./types";

export const SEEDS: ClientSeed[] = [
  northwind as unknown as ClientSeed,
  blueharbor as unknown as ClientSeed,
];

export const DEFAULT_CLIENT_ID = SEEDS[0].clientId;

export function getSeed(clientId: string): ClientSeed {
  return SEEDS.find((s) => s.clientId === clientId) ?? SEEDS[0];
}

// The four seeded quality metrics that used to live here (faithfulness 0.96,
// citation accuracy 0.94, answer relevance 0.92, hallucination 0.008) are gone.
// They were invented, and labelling them "seed" was not enough on a page whose
// whole purpose is to show measured quality. Real numbers come from lib/evals.ts
// — "Run evals" on /evals, or `npm run evals`.
export const GOLDEN_SET_SIZE = SEEDS.reduce((n, s) => n + s.goldens.length, 0);
