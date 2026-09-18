// Multi-turn discussion over one client's contracts.
//
// The Ask screen stays single-shot on purpose — every answer there is
// independently verifiable, which is the property a legal tool wants. This adds
// a separate, explicitly temporary mode for the times a single question is not
// enough.
//
// The load-bearing part is NOT passing history to the model. It is rewriting the
// follow-up before retrieval runs:
//
//   turn 1  "Does the Cascade agreement auto-renew?"
//   turn 2  "How much notice to stop it?"
//
// Searching for "How much notice to stop it?" retrieves nothing useful — "it"
// appears in no contract, and the words that would find the clause ("Cascade",
// "renewal", "notice of non-renewal") are in the PREVIOUS turn. So turn 2 is
// first rewritten into a standalone question, and everything downstream —
// retrieval, the guardrail, citations — operates on that.
//
// The rewriter's failure mode, found the first time this was tested: given
// "And the vendor agreement?" after a question about the NDA with Lighthouse
// Analytics, it produced "Which state law governs the vendor agreement WITH
// LIGHTHOUSE ANALYTICS" — carrying a counterparty across to a contract that has
// a different one. Retrieval then scored 0.603 and the model refused, correctly,
// because nothing matched that combination. So the prompt now says to replace
// the subject and keep nothing else attached to it.
//
// Rewriting before the guardrail rather than after is deliberate: the guardrail
// asks "is this question about these documents?", and it can only answer that
// honestly about a self-contained question. A bare "what about the other one?"
// would otherwise inherit relevance from the conversation instead of earning it.

import { generateAnswer } from "./providers";
import { runQuery } from "./rag";
import type { QueryResult } from "./types";

export type Turn = {
  role: "user" | "assistant";
  content: string;
};

export type DiscussResult = {
  /** The answer for this turn. */
  result: QueryResult;
  /** The standalone question retrieval actually ran on. */
  searchedFor: string;
  /** True when the follow-up had to be rewritten to stand on its own. */
  rewritten: boolean;
};

/** How many prior turns the rewriter sees. Enough for context, bounded for cost. */
const HISTORY_WINDOW = 6;

const REWRITE_SYSTEM = `You rewrite a follow-up question so it can be understood on its own.

You are given a short conversation about a set of contracts, then the user's latest message.
Rewrite that latest message as a single self-contained question, resolving every pronoun and
ellipsis from the conversation ("it", "that one", "the other", "and the notice period?").

Rules:
- Keep the user's intent exactly. Do not answer, expand, or add detail they did not ask for.
- Carry over ONLY what is needed to resolve the reference — usually the subject, and
  nothing else. Details attached to an earlier subject rarely apply to a new one: a
  different contract has different parties, dates and amounts.
- If the user names a NEW subject ("and the vendor agreement?"), keep the earlier
  QUESTION and replace the subject. Do not attach the earlier subject's party names.
- If the latest message is ALREADY self-contained, return it unchanged.
- Output ONLY the rewritten question. No preamble, no quotes, no explanation.

Example
  Conversation: User asked which state law governs the NDA with Lighthouse Analytics.
  Latest message: "And the vendor agreement?"
  Correct:   Which state law governs the vendor agreement?
  Wrong:     Which state law governs the vendor agreement with Lighthouse Analytics?`;

/**
 * Turn a follow-up into a standalone question.
 *
 * Returns the original on any failure. A rewrite is an optimisation, not a
 * correctness requirement: a failed rewrite should degrade to the single-shot
 * behaviour the Ask screen already has, never to an error.
 */
async function toStandaloneQuestion(
  history: Turn[],
  question: string
): Promise<{ question: string; rewritten: boolean }> {
  if (history.length === 0) return { question, rewritten: false };

  const transcript = history
    .slice(-HISTORY_WINDOW)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");

  try {
    const rewritten = (
      await generateAnswer(REWRITE_SYSTEM, `Conversation:\n${transcript}\n\nLatest message: ${question}`)
    ).trim();
    // A rewrite that comes back empty, or as an essay, is a malfunction — the
    // instruction is "output only the question".
    if (!rewritten || rewritten.length > 400) return { question, rewritten: false };
    return { question: rewritten, rewritten: rewritten.toLowerCase() !== question.trim().toLowerCase() };
  } catch {
    return { question, rewritten: false };
  }
}

export async function discuss(
  clientId: string,
  history: Turn[],
  question: string
): Promise<DiscussResult> {
  const standalone = await toStandaloneQuestion(history, question);
  // From here it is the ordinary pipeline: hybrid retrieval, the same guardrail,
  // the same citations. A discussion turn is not a weaker kind of answer.
  const { result } = await runQuery(clientId, standalone.question);
  return {
    result,
    searchedFor: standalone.question,
    rewritten: standalone.rewritten,
  };
}
