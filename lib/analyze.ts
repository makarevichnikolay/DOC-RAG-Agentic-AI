// Lightweight, deterministic clause analysis for uploaded documents.
// Runs on the recognized text (from image OCR, PDF text-layer, or .txt) and
// derives risk/deadline flags. Rule-based on purpose: predictable for the demo
// and easy to explain. Returns at most MAX_FLAGS, by priority.
import type { Flag } from "./types";

const MAX_FLAGS = 3;

function noticeDays(text: string): string | null {
  const m = text.match(
    /(\d{1,3})\s*(?:\([a-z ]+\)\s*)?days'?\s+(?:prior\s+)?(?:written\s+)?notice/i
  );
  return m ? m[1] : null;
}

function governingLaw(text: string): string | null {
  const m = text.match(
    /governed by (?:and construed in accordance with )?the laws of (?:the )?(?:state of )?([A-Z][A-Za-z ]{2,30}?)[\.,;\)]/
  );
  return m ? m[1].trim() : null;
}

export function deriveFlags(fileName: string, title: string, text: string): Flag[] {
  const t = text.toLowerCase();
  const flags: Flag[] = [];
  const push = (key: string, level: Flag["level"], cite: string, msg: string) =>
    flags.push({ id: `up::${fileName}::${key}`, level, doc: title, cite, text: msg });

  // 1) Auto-renewal / auto-extension (deadline risk) — highest operational value.
  if (
    /(automatic(?:ally)?\s+(?:renew|extend)|auto-?renew|(?:renew|extend)[a-z]*\s+for\s+(?:successive|subsequent)|evergreen|tacit\s+renewal)/i.test(
      t
    )
  ) {
    const d = noticeDays(text);
    push(
      "autorenew",
      "warn",
      "renewal",
      d
        ? `Auto-renewal clause detected — non-renewal requires ${d} days' notice. Track the deadline.`
        : "Auto-renewal clause detected — track the non-renewal notice deadline."
    );
  }

  // 2) Change of control — critical in M&A / sale.
  if (/change\s+(?:in|of)\s+control/i.test(t)) {
    push("coc", "danger", "change of control", "Change-of-control clause present — critical in a sale / M&A.");
  }

  // 3) Insurance obligation → typically an operational task.
  if (/\binsur(?:e|ance|ed)\b/i.test(t)) {
    push("insurance", "info", "insurance", "Insurance obligation present — ensure the required coverage is in place.");
  }

  // 4) Limitation of liability present / missing (missing flagged only for
  //    service/supply-type agreements, where a liability cap is expected).
  const liabilityPresent =
    /(limitation[s]?\s+of\s+liability|liabilit\w*\s+limitation|liability\s+(?:cap|shall\s+not\s+exceed|will\s+not\s+exceed|not\s+exceed|is\s+limited|shall\s+be\s+limited))/i.test(
      t
    );
  const serviceLike =
    /(master\s+services\s+agreement|services\s+agreement|\bsupplier\b|statement\s+of\s+work|vendor\s+agreement|purchase\s+order)/i.test(
      t
    );
  if (liabilityPresent) {
    push("liability", "info", "liability", "Limitation-of-liability clause present — verify the cap fits your risk policy.");
  } else if (serviceLike) {
    push("noliability", "danger", "liability", "No limitation-of-liability clause found — review the risk exposure.");
  }

  // 5) Governing law (informational).
  const law = governingLaw(text);
  if (law) {
    push("law", "info", "governing law", `Governing law: ${law}. Confirm it fits your jurisdiction.`);
  }

  return flags.slice(0, MAX_FLAGS);
}
