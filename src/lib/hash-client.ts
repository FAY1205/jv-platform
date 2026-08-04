// Client-safe SHA-256 fingerprint of raw file bytes (ADR-0038: identical-file
// re-upload warn). Uses WebCrypto, available in every modern browser and Node 18+.
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
