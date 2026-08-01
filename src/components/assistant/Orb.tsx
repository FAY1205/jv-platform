"use client";

import * as React from "react";

type Palette = {
  base1: string; base2: string; edge: string;
  rim: string; rimGlow: string;
  filaments: [string, number][];
};

// Theme-aware plasma palette (owner redesign 2026-08-01: a dark glass sphere with
// amber plasma wisps at the rim — not a solid honey ball). Colours here are canvas
// paint (not DOM styling), so they live with the renderer; the DOM chrome around the
// orb uses tokens (PRN-12).
function orbPalette(): Palette {
  const attr = document.documentElement.getAttribute("data-theme");
  const dark = attr === "dark" || (attr !== "light" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  return dark
    ? { base1: "#150f06", base2: "#241705", edge: "rgba(246,184,86,.16)",
        rim: "rgba(246,184,86,.85)", rimGlow: "rgba(224,145,43,.5)",
        filaments: [["#F6B856", 0.9], ["#E0912B", 0.75], ["#FFE9C4", 0.5]] }
    : { base1: "#1a1207", base2: "#2b1c08", edge: "rgba(224,145,43,.18)",
        rim: "rgba(224,145,43,.9)", rimGlow: "rgba(198,125,30,.45)",
        filaments: [["#E0912B", 0.9], ["#F6B856", 0.7], ["#FFE9C4", 0.45]] };
}

// Per-filament shape: base radius (fraction of R), how deep its inward dip swings,
// wobble harmonics and drift speeds (rad/ms — very slow, ambient motion).
const FILAMENTS = [
  { base: 0.88, dip: 0.1, k: 3, w1: 0.00016, w2: 0.00011, w3: 0.00005 },
  { base: 0.85, dip: 0.2, k: 4, w1: 0.00012, w2: 0.00017, w3: 0.00004 },
  { base: 0.9, dip: 0.4, k: 2, w1: 0.00009, w2: 0.00013, w3: 0.00006 },
] as const;

export function Orb({ size, animate = false, className }: { size: number; animate?: boolean; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Size the canvas UNCONDITIONALLY (backing store + CSS) before touching the 2d
    // context, so a no-canvas environment (jsdom → getContext returns null) still gets
    // a correctly-sized element and only skips the drawing.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    const g = canvas.getContext("2d");
    if (!g) return; // jsdom / no 2d support — sized but not drawn; never throw
    const R = size / 2;
    const ph = ((size * 97) % 628) / 100; // deterministic phase from size (no Math.random)

    const tracePath = (at: number, f: (typeof FILAMENTS)[number], i: number) => {
      const STEPS = 56;
      g.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const th = (s / STEPS) * Math.PI * 2;
        const wob =
          Math.sin(th * f.k + ph + i * 2.1 + at * f.w1) * 0.055 +
          Math.sin(th * (f.k + 2) - ph * 1.7 - i + at * f.w2) * 0.04;
        // One side hugs the rim, the opposite side dips toward the centre — the
        // "veil" crossing the dark interior in the reference.
        const dip = Math.max(0, Math.sin(th + ph * 2 + i * 2.6 + at * f.w3)) * f.dip;
        const r = R * (f.base - dip + wob);
        const x = R + Math.cos(th) * r;
        const y = R + Math.sin(th) * r;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };

    const draw = (at: number) => {
      const P = orbPalette();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath(); g.arc(R, R, R - 0.5, 0, 6.2832); g.clip();

      // Dark glass interior — near-black warm centre, barely lighter toward the edge.
      const base = g.createRadialGradient(R, R, R * 0.1, R, R, R);
      base.addColorStop(0, P.base1); base.addColorStop(1, P.base2);
      g.fillStyle = base; g.fillRect(0, 0, size, size);

      // Inner edge bloom: the glass catching the plasma light near the rim.
      const edge = g.createRadialGradient(R, R, R * 0.66, R, R, R);
      edge.addColorStop(0, "rgba(0,0,0,0)"); edge.addColorStop(1, P.edge);
      g.fillStyle = edge; g.fillRect(0, 0, size, size);

      // Plasma wisps: wide blurred pass (glow) + thin bright core, additive.
      g.globalCompositeOperation = "lighter";
      FILAMENTS.forEach((f, i) => {
        const [color, alpha] = P.filaments[i];
        tracePath(at, f, i);
        g.strokeStyle = color;
        g.filter = `blur(${size * 0.06}px)`;
        g.globalAlpha = alpha * 0.5;
        g.lineWidth = size * 0.07;
        g.stroke();
        g.filter = `blur(${size * 0.012}px)`;
        g.globalAlpha = alpha;
        g.lineWidth = size * 0.014;
        g.stroke();
      });
      g.filter = "none"; g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      g.restore();

      // Rim: a soft glow ring under a thin crisp ring — the plasma-ball glass edge.
      g.globalCompositeOperation = "lighter";
      g.beginPath(); g.arc(R, R, R - 1.2, 0, 6.2832);
      g.strokeStyle = P.rimGlow; g.lineWidth = 2.4; g.filter = `blur(${Math.max(1, size * 0.03)}px)`; g.stroke();
      g.filter = "none";
      g.beginPath(); g.arc(R, R, R - 0.9, 0, 6.2832);
      g.strokeStyle = P.rim; g.lineWidth = 1; g.stroke();
      g.globalCompositeOperation = "source-over";
    };

    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moving = animate && !reduce;
    let raf = 0;
    // ~30fps cap: ambient motion stays cheap (the launcher animates on every screen).
    const FRAME_MS = 1000 / 30;
    // Animation time ACCUMULATES only while the tab is visible: rAF timestamps are
    // wall-clock, so drawing from them after a hidden stretch jump-cuts the wisps
    // (reads as the animation "resetting"). Pausing the clock resumes seamlessly.
    let acc = 0;
    let lastT: number | null = null;
    let lastDrawn = -Infinity;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { lastT = null; return; }
      if (lastT !== null) acc += Math.min(t - lastT, 100);
      lastT = t;
      if (acc - lastDrawn < FRAME_MS) return;
      lastDrawn = acc;
      draw(acc);
    };

    const start = () => { if (moving && !raf) { lastT = null; raf = requestAnimationFrame(loop); } };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; lastT = null; } };

    if (moving) start();
    else draw(0);

    // Fully release the loop while the tab is hidden; resume from the paused clock.
    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener("visibilitychange", onVis);

    // Repaint on theme flip (static orbs especially).
    const repaint = () => draw(acc);
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", repaint);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      mo.disconnect();
      mq?.removeEventListener?.("change", repaint);
    };
  }, [size, animate]);

  return (
    <span aria-hidden="true" className={"grid place-items-center rounded-full " + (className ?? "")}>
      <canvas ref={ref} className="block rounded-full" />
    </span>
  );
}
