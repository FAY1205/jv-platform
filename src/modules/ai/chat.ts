import { convertToModelMessages, stepCountIs, streamText, type LanguageModel, type UIMessage } from "ai";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import { logError } from "@/lib/observability";
import { jsonError } from "@/lib/http";
import { buildAiTools } from "./tools";
import { buildSystemPrompt, ScreenKeySchema } from "./prompt";
import { AI_MODEL, costMicroUsd } from "./pricing";
import { rateDecision } from "./budget";
import { loadAiSettings } from "./settings";
import { questionsInLastMinute, recordAttempt, finalizeUsage } from "./usage";

// The assistant core (AIA-01..06). The model is INJECTED so tests drive the real
// route/tools with ai/test mocks — CI never spends a token. Gates are checked
// before any model call; usage is recorded in onFinish (counts only, SEC-05).

type Db = PostgresJsDatabase<typeof schema>;

export const ChatBodySchema = z.object({
  messages: z.array(z.looseObject({ id: z.string().max(64), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.unknown()) })).min(1).max(24),
  screen: z.string().max(64).optional(),
});
export type ChatBody = z.infer<typeof ChatBodySchema>;

const MAX_QUESTION_CHARS = 2000;

/** The last user message's visible text (for the length cap). */
function lastUserText(messages: ChatBody["messages"]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return (last.parts as { type?: string; text?: string }[]).map((p) => (p?.type === "text" ? (p.text ?? "") : "")).join("");
}

export async function assistantGate(db: Db, scope: ScopeContext, opts: { hasCredential: boolean; now: Date }) {
  // ADR-0036 (BYO): the assistant runs on the TENANT's own provider credential. The
  // old production/free-tier guard (LGL-04, platform key) no longer applies — the
  // tenant uses their own paid provider account under their own data terms. The
  // presence of a stored credential is the gate.
  if (!opts.hasCredential) {
    return { ok: false as const, code: "ai_disabled" as const, status: 503, message: "Add your AI provider API key in Settings → AI assistant to use the assistant." };
  }
  const settings = await loadAiSettings(scope);
  if (!settings.enabled) {
    return { ok: false as const, code: "ai_disabled" as const, status: 403, message: "The assistant is switched off in Settings → AI assistant." };
  }
  if (!rateDecision({ questionsLastMinute: await questionsInLastMinute(db, scope, scope.userId, opts.now) }).allowed) {
    return { ok: false as const, code: "ai_rate_limited" as const, status: 429, message: "Too many questions — try again in a minute." };
  }
  // The monthly spend cap was removed (ADR-0036 follow-up): each tenant caps spend in
  // their own provider dashboard. The rate limit above stays as the abuse guardrail.
  return { ok: true as const };
}

export async function assistantResponse(db: Db, scope: ScopeContext, input: ChatBody, deps: { model: LanguageModel; modelId?: string; now: Date }): Promise<Response> {
  // The id metering keys on: the tenant's chosen model (ADR-0036), else the platform default.
  const meterModel = deps.modelId ?? AI_MODEL;
  if (lastUserText(input.messages).length > MAX_QUESTION_CHARS) {
    return jsonError("invalid_input", "Question too long.", 400);
  }
  const screen = ScreenKeySchema.parse(input.screen);

  // AIA-07 / audit F-1: record the attempt BEFORE any model call. A client that aborts the
  // stream never triggers onFinish, and N concurrent requests would otherwise all observe the
  // same pre-write count — pre-inserting closes both. The authoritative rate check then runs on
  // the now-inserted attempt (`attemptsThisMinute - 1` = questions that preceded this one, the
  // same predicate the gate uses), so a burst that slipped past the stale gate check is caught.
  const usageId = await recordAttempt(db, scope, { userId: scope.userId, model: meterModel });
  const attemptsThisMinute = await questionsInLastMinute(db, scope, scope.userId, deps.now);
  if (!rateDecision({ questionsLastMinute: attemptsThisMinute - 1 }).allowed) {
    return jsonError("ai_rate_limited", "Too many questions — try again in a minute.", 429);
  }

  const recent = input.messages.slice(-12); // design §4: only the last 12 messages are replayed
  const messages = await convertToModelMessages(recent as unknown as UIMessage[]);
  const finalize = async (inputTokens: number, outputTokens: number) => {
    const cost = costMicroUsd(meterModel, inputTokens, outputTokens) ?? 0;
    await finalizeUsage(db, scope, usageId, { inputTokens, outputTokens, costMicroUsd: cost });
  };
  const result = streamText({
    model: deps.model,
    system: buildSystemPrompt(screen),
    messages,
    tools: buildAiTools(scope),
    stopWhen: stepCountIs(5),
    maxOutputTokens: 1024,
    onFinish: async ({ totalUsage }) => {
      try {
        await finalize(totalUsage.inputTokens ?? 0, totalUsage.outputTokens ?? 0);
      } catch (e) {
        logError("ai_usage_record_failed", { detail: e instanceof Error ? e.message : "unknown" }); // never break the stream (SEC-05: no content)
      }
    },
    onAbort: async ({ steps }) => {
      // The attempt is already recorded + counted (pre-insert); meter the partial usage from
      // any completed steps so an aborted stream isn't free (F-1).
      try {
        const inputTokens = steps.reduce((s, st) => s + (st.usage?.inputTokens ?? 0), 0);
        const outputTokens = steps.reduce((s, st) => s + (st.usage?.outputTokens ?? 0), 0);
        await finalize(inputTokens, outputTokens);
      } catch (e) {
        logError("ai_usage_abort_finalize_failed", { detail: e instanceof Error ? e.message : "unknown" });
      }
    },
  });
  return result.toUIMessageStreamResponse();
}
