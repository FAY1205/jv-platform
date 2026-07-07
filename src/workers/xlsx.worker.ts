import { parseWorkbook, type ParsedWorkbook } from "@/modules/sources/parse";

// ─────────────────────────────────────────────────────────────────────────────
// Client-side .xlsx/.csv read off the main thread (FEP-06). Thin glue over the pure
// parseWorkbook helper — all logic (and its tests) live there. The upload flow (WP-020)
// posts an ArrayBuffer in and gets { headers, rows } back for detection + preview.
// File bytes are DATA (PRN-10); nothing here is executed or trusted as instructions.
// ─────────────────────────────────────────────────────────────────────────────

export interface XlsxParseRequest {
  id: string;
  buffer: ArrayBuffer;
}

export interface XlsxParseResponse {
  id: string;
  ok: boolean;
  result?: ParsedWorkbook;
  error?: string;
}

// Minimal worker-scope surface (avoids a webworker/dom lib clash in tsconfig).
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: XlsxParseRequest }) => void): void;
}

const ctx = self as unknown as WorkerScope;

ctx.addEventListener("message", (event) => {
  const { id, buffer } = event.data;
  try {
    const result = parseWorkbook(buffer);
    ctx.postMessage({ id, ok: true, result } satisfies XlsxParseResponse);
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : "workbook parse failed",
    } satisfies XlsxParseResponse);
  }
});
