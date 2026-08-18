// Pure no-dep renderer for streamed assistant text (design §6: plain language,
// dash bullets for 3+ numbers, mono refs). NOT a markdown engine — only the four
// things the system prompt actually emits: **bold**, `code`/paths, dash/•/* bullets,
// ref IDs. The React layer renders these spans (no dangerouslySetInnerHTML).

export type InlineSpan = { kind: "text" | "bold" | "ref" | "code"; text: string };
export type AnswerBlock =
  | { type: "p"; spans: InlineSpan[] }
  | { type: "ul"; items: InlineSpan[][] };

const BULLET_RE = /^\s*[-–•*]\s+(.*)$/;
// PR- is the current partner prefix (migration 0022); JV- stays matched so historical
// refs (e.g. quoted from the activity log) still render as mono ref spans.
const REF_RE = /\b(PR-\d{3,}|JV-\d{3,}|LD-\d{2}-\d{5,}|IM-\d{2}-\d{3,}|UP-\d{4}-\d{3,})\b/g;

/** Push bold + ref spans for a segment that is NOT inside a code span. */
function pushBoldAndRefs(segment: string, spans: InlineSpan[]): void {
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (!t) return;
    let idx = 0;
    let r: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((r = REF_RE.exec(t))) {
      if (r.index > idx) spans.push({ kind: "text", text: t.slice(idx, r.index) });
      spans.push({ kind: "ref", text: r[0] });
      idx = r.index + r[0].length;
    }
    if (idx < t.length) spans.push({ kind: "text", text: t.slice(idx) });
  };
  while ((m = boldRe.exec(segment))) {
    if (m.index > last) pushText(segment.slice(last, m.index));
    spans.push({ kind: "bold", text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < segment.length) pushText(segment.slice(last));
}

/** Split a line into spans. `code` (backtick-delimited — file paths, statuses, ZIPs the
 *  model quotes) is matched FIRST and its content stays literal (no bold/ref inside); the
 *  segments between code spans get bold, then refs. */
function inlineSpans(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(line))) {
    if (m.index > last) pushBoldAndRefs(line.slice(last, m.index), spans);
    spans.push({ kind: "code", text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) pushBoldAndRefs(line.slice(last), spans);
  return spans;
}

export function formatAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", spans: inlineSpans(para.join(" ").trim()) });
      para = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      const item = inlineSpans(bullet[1].trim());
      if (prev && prev.type === "ul") prev.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else if (line.trim() === "") {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  return blocks;
}
