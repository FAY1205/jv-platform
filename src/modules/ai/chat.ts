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
import { budgetDecision, rateDecision } from "./budget";
import { loadAiSettings } from "./settings";
import { monthToDateMicroUsd, questionsInLastMinute, recordUsage } from "./usage";

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

export async function assistantGate(db: Db, scope: ScopeContext, opts: { appEnv: "development" | "preview" | "production"; aiTier: "paid" | "free-dev"; hasProviderKey: boolean; now: Date }) {
  // LGL-04/SEC-07 tier guard: prod may never run on the training-permitted free tier.
  if (opts.appEnv === "production" && opts.aiTier !== "paid") {
    return { ok: false as const, code: "ai_disabled" as const, status: 503, message: "Assistant unavailable: production requires the paid AI tier (see Settings → AI assistant)." };
  }
  if (!opts.hasProviderKey) {
    return { ok: false as const, code: "ai_disabled" as const, status: 503, message: "Assistant is not configured yet." };
  }
  const settings = await loadAiSettings(scope);
  if (!settings.enabled) {
    return { ok: false as const, code: "ai_disabled" as const, status: 403, message: "The assistant is switched off in Settings → AI assistant." };
  }
  if (!rateDecision({ questionsLastMinute: await questionsInLastMinute(db, scope, scope.userId, opts.now) }).allowed) {
    return { ok: false as const, code: "ai_rate_limited" as const, status: 429, message: "Too many questions — try again in a minute." };
  }
  if (!budgetDecision({ spentMicroUsd: await monthToDateMicroUsd(db, scope, opts.now), capUsd: settings.capUsd }).allowed) {
    return { ok: false as const, code: "ai_budget_reached" as const, status: 402, message: "This month's AI allowance is used up. Raise the limit in Settings → AI assistant." };
  }
  return { ok: true as const };
}

export async function assistantResponse(db: Db, scope: ScopeContext, input: ChatBody, deps: { model: LanguageModel; now: Date }): Promise<Response> {
  if (lastUserText(input.messages).length > MAX_QUESTION_CHARS) {
    return jsonError("invalid_input", "Question too long.", 400);
  }
  const screen = ScreenKeySchema.parse(input.screen);
  const recent = input.messages.slice(-12); // design §4: only the last 12 messages are replayed
  const messages = await convertToModelMessages(recent as unknown as UIMessage[]);
  const result = streamText({
    model: deps.model,
    system: buildSystemPrompt(screen),
    messages,
    tools: buildAiTools(scope),
    stopWhen: stepCountIs(5),
    maxOutputTokens: 1024,
    onFinish: async ({ totalUsage }) => {
      try {
        const inputTokens = totalUsage.inputTokens ?? 0;
        const outputTokens = totalUsage.outputTokens ?? 0;
        const cost = costMicroUsd(AI_MODEL, inputTokens, outputTokens) ?? 0;
        await recordUsage(db, scope, { userId: scope.userId, model: AI_MODEL, inputTokens, outputTokens, costMicroUsd: cost });
      } catch (e) {
        logError("ai_usage_record_failed", { detail: e instanceof Error ? e.message : "unknown" }); // never break the stream (SEC-05: no content)
      }
    },
  });
  return result.toUIMessageStreamResponse();
}
