import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash-client";

// ADR-0038: identical-file re-upload warn — the client fingerprints the raw file
// bytes so the server can recognise a file it already imported.
describe("sha256Hex (upload duplicate-file fingerprint)", () => {
  it("produces the canonical lowercase-hex SHA-256 of the bytes", async () => {
    const bytes = new TextEncoder().encode("abc");
    await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes empty input deterministically", async () => {
    await expect(sha256Hex(new ArrayBuffer(0))).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
