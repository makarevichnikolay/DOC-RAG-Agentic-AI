// Server-side client (tenant) configuration: where each client's contract files live.
// Retrieval and the document API are hard-scoped to these directories (isolation).
// NOTE: imports node:path — server-only. Client components should use lib/seeds.ts instead.

import path from "node:path";

export type ClientConfig = {
  id: string;
  name: string;
  industry: string;
  /** Directory with the contracts that get ingested into this client's index. */
  contractsDir: string;
  /** Directory with extra pre-loaded files used by the mock "Upload" flow (viewable, not indexed). */
  extraDir: string;
};

export const CLIENT_CONFIGS: ClientConfig[] = [
  {
    id: "northwind-logistics",
    name: "Northwind Logistics",
    industry: "Logistics",
    contractsDir: path.join(process.cwd(), "data", "contracts"),
    extraDir: path.join(process.cwd(), "data", "northwind-logistics", "extra"),
  },
  {
    id: "blue-harbor-retail",
    name: "Blue Harbor Retail",
    industry: "Retail",
    contractsDir: path.join(process.cwd(), "data", "blue-harbor-retail", "contracts"),
    extraDir: path.join(process.cwd(), "data", "blue-harbor-retail", "extra"),
  },
];

export function getClientConfig(id: string): ClientConfig | null {
  return CLIENT_CONFIGS.find((c) => c.id === id) ?? null;
}
