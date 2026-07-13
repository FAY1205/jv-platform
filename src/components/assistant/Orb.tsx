"use client";

import * as React from "react";

type Palette = {
  base1: string; base2: string; additive: boolean;
  ribbons: [string, number][];
  under: string; rim: string; arc: string; spec: string;
};

// Theme-aware glass palette — honey-glass on paper, petrol-glass in dark. Values are
// the approved mockup's (rev-7). Colours here are canvas paint (not DOM styling), so
// they live with the renderer; the DOM chrome around the orb uses tokens (PRN-12).
function orbPalette(): Palette {
  const attr = document.documentElement.getAttribute("data-theme");
  const dark = attr === "dark" || (attr !== "light" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  return dark
    ? { base1: "#1E2C33", base2: "#0B1114", additive: true,
        ribbons: [["#E0912B", 0.85], ["#F6B856", 0.7], ["#5FA0C8", 0.5], ["#FFFFFF", 0.45], ["#C67D1E", 0.6]],
        under: "rgba(95,160,200,.25)", rim: "rgba(255,255,255,.35)", arc: "rgba(255,255,255,.7)", spec: "rgba(255,255,255,.45)" }
    : { base1: "#FFF9EC", base2: "#EBCF9C", additive: false,
        ribbons: [["#E0912B", 0.8], ["#C67D1E", 0.65], ["#8F5416", 0.4], ["#2E6E93", 0.28], ["#FFFFFF", 0.38]],
        under: "rgba(46,110,147,.14)", rim: "rgba(143,84,22,.5)", arc: "rgba(255,255,255,.95)", spec: "rgba(255,255,255,.65)" };
}

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

    const draw = (t: number) => {
      const P = orbPalette();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath(); g.arc(R, R, R - 0.5, 0, 6.2832); g.clip();
      const base = g.createRadialGradient(R * 0.72, R * 0.62, R * 0.12, R, R, R);
      base.addColorStop(0, P.base1); base.addColorStop(1, P.base2);
      g.fillStyle = base; g.fillRect(0, 0, size, size);
      P.ribbons.forEach((rb, i) => {
        const white = rb[0] === "#FFFFFF";
        g.globalCompositeOperation = P.additive || white ? "lighter" : "source-over";
        const rot = ph + i * 1.3 + (animate ? t * 0.00022 * (i % 2 ? 1 : -1) * (1 + i * 0.25) : i * 0.7);
        const squish = 0.32 + 0.1 * Math.sin(ph + i + (animate ? t * 0.0006 : 0));
        g.save();
        g.translate(R + Math.sin(rot * 1.4 + i) * R * 0.08, R + Math.cos(rot + i) * R * 0.08);
        g.rotate(rot);
        g.beginPath(); g.ellipse(0, 0, R * 0.62, R * squish, 0, 0, 6.2832);
        g.filter = `blur(${size * 0.055}px)`;
        g.strokeStyle = rb[0]; g.globalAlpha = rb[1] * 0.55; g.lineWidth = size * 0.085; g.stroke();
        g.filter = `blur(${size * 0.014}px)`;
        g.globalAlpha = rb[1]; g.lineWidth = size * 0.02; g.stroke();
        g.restore();
      });
      g.filter = "none"; g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      const glow = g.createRadialGradient(R, R * 1.5, 0, R, R * 1.5, R);
      glow.addColorStop(0, P.under); glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow; g.fillRect(0, 0, size, size);
      g.restore();
      g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.strokeStyle = P.rim; g.lineWidth = 1.1; g.stroke();
      g.beginPath(); g.arc(R, R, R - 1.6, Math.PI * 1.05, Math.PI * 1.75); g.strokeStyle = P.arc; g.lineWidth = 1.5; g.stroke();
      const spec = g.createRadialGradient(R * 0.62, R * 0.5, 0, R * 0.62, R * 0.5, R * 0.45);
      spec.addColorStop(0, P.spec); spec.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = spec; g.beginPath(); g.ellipse(R * 0.62, R * 0.48, R * 0.34, R * 0.22, -0.5, 0, 6.2832); g.fill();
    };

    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (animate && !reduce) {
      const loop = (t: number) => { if (!document.hidden) draw(t); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    } else {
      draw(0);
    }

    // Repaint on theme flip (static orbs especially).
    const repaint = () => draw(0);
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", repaint);

    return () => {
      if (raf) cancelAnimationFrame(raf);
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
