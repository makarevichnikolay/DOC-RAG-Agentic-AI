// Roles, navigation and the role x section access matrix (mock auth).
// Client-safe: no Node imports here.

import type { Role } from "./types";

export const ROLES: {
  id: Role;
  label: string;
  defaultName: string;
  blurb: string;
}[] = [
  {
    id: "analyst",
    label: "Legal & Operations",
    defaultName: "Alex Morgan",
    blurb:
      "Day-to-day contract work: Documents, Ask, Register, Flags & Tasks (fits legal analysts, ops and procurement).",
  },
  {
    id: "admin",
    label: "Partner / Admin",
    defaultName: "Jordan Lee",
    blurb: "Everything + cross-client Portfolio, Inspector & Evals and Settings.",
  },
];

export function roleLabel(role: Role): string {
  return ROLES.find((r) => r.id === role)?.label ?? role;
}

export type SectionId =
  | "dashboard"
  | "clients"
  | "documents"
  | "ask"
  | "register"
  | "flags"
  | "portfolio"
  | "evals"
  | "settings";

const ALL: Role[] = ["analyst", "operations", "admin"];

export const NAV: {
  id: SectionId;
  label: string;
  href: string;
  icon: string;
  roles: Role[];
  viewOnly?: Role[];
}[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "▦", roles: ALL },
  { id: "clients", label: "Clients", href: "/clients", icon: "◈", roles: ALL },
  { id: "documents", label: "Documents", href: "/documents", icon: "▤", roles: ALL },
  { id: "ask", label: "Ask (Q&A)", href: "/ask", icon: "✦", roles: ALL },
  { id: "flags", label: "Flags & Tasks", href: "/flags", icon: "⚑", roles: ALL },
  { id: "portfolio", label: "Portfolio", href: "/portfolio", icon: "◫", roles: ["admin"] },
  { id: "evals", label: "Inspector & Evals", href: "/evals", icon: "◎", roles: ["admin"] },
  { id: "settings", label: "Settings", href: "/settings", icon: "⚙", roles: ["admin"] },
];

export function canAccess(role: Role, id: SectionId): boolean {
  const item = NAV.find((n) => n.id === id);
  return !!item && item.roles.includes(role);
}

export function isViewOnly(role: Role, id: SectionId): boolean {
  const item = NAV.find((n) => n.id === id);
  return !!item?.viewOnly?.includes(role);
}
