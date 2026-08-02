import * as React from "react";

// A lightweight CSS "orb" mark for small slots (the panel header). The WebGL Orb
// (Orb.tsx) draws a RING with a transparent centre — great at the 52px launcher, but
// below ~40px the ring all but disappears and it still needs its own GL context (a
// second live context next to the launcher's). At header size a filled radial-gradient
// disc reads as an orb, renders identically on every browser, and costs nothing. The
// animated WebGL orb stays on the launcher. Colours come from brand tokens (theme-aware);
// the white sheen is a fixed highlight that works on both themes.
export function MiniOrb({ size, className }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={"assistant-miniorb relative block shrink-0 rounded-full " + (className ?? "")}
      style={{ width: size, height: size }}
    />
  );
}
