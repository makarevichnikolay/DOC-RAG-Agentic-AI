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

// Seed metrics for the Evals panel (computed offline on the golden sets — SEED, not live).
export const EVAL_METRICS = {
  lastRun: "2026-07-08",
  goldenSetSize: SEEDS.reduce((n, s) => n + s.goldens.length, 0),
  faithfulness: 0.96,
  citationAccuracy: 0.94,
  answerRelevance: 0.92,
  hallucinationRate: 0.008,
};
