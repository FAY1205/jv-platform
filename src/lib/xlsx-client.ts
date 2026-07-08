import type { XlsxParseResponse } from "@/workers/xlsx.worker";

// Parse an uploaded workbook OFF the main thread (FEP-06) via the xlsx Web Worker.
export function parseWorkbookInWorker(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/xlsx.worker.ts", import.meta.url));
    const id = crypto.randomUUID();
    worker.addEventListener("message", (e: MessageEvent<XlsxParseResponse>) => {
      if (e.data.id !== id) return;
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? "Could not read the workbook."));
    });
    worker.addEventListener("error", (e) => {
      worker.terminate();
      reject(new Error(e.message || "Worker error while parsing."));
    });
    file
      .arrayBuffer()
      .then((buffer) => worker.postMessage({ id, buffer }, [buffer]))
      .catch(reject);
  });
}
