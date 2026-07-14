import { describe, expect, it } from "vitest";
import { googleSearchUrl } from "@/lib/search-links";

describe("googleSearchUrl (T3)", () => {
  it("joins the non-empty parts and URL-encodes them", () => {
    expect(googleSearchUrl(["11 Oak St", null, "Dallas", "TX", undefined, "75201"])).toBe(
      "https://www.google.com/search?q=11%20Oak%20St%20Dallas%20TX%2075201",
    );
  });
});
