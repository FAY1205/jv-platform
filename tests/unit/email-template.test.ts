import { describe, expect, it } from "vitest";
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS } from "@/modules/notify/email-template";
import { lightColors } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

describe("escapeHtml", () => {
  it("neutralises HTML-significant characters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("emailButton", () => {
  it("renders an anchor with the marigold fill value and an escaped href/label", () => {
    const html = emailButton({ href: "https://app.test/x?a=1&b=2", label: "Open <leads>" });
    expect(html).toContain(lightColors.brand); // fill from the token source (SEAM-08)
    expect(html).toContain("https://app.test/x?a=1&amp;b=2");
    expect(html).toContain("Open &lt;leads&gt;");
  });
});

describe("renderEmailDocument", () => {
  const doc = renderEmailDocument({ title: "T", preheader: "P", contentHtml: "<p>hello</p>" });
  it("is one HTML document that inlines the content", () => {
    expect(doc).toMatch(/^<!DOCTYPE html>/i);
    expect(doc).toContain("<p>hello</p>");
    expect(doc).toContain("P"); // preheader
  });
  it("renders the brand from APP_NAME (PRN-12: source uses the constant, not a literal)", () => {
    expect(doc).toContain(APP_NAME);
  });
  it("re-exports the light token palette for content builders", () => {
    expect(EMAIL_COLORS).toBe(lightColors);
  });
});
