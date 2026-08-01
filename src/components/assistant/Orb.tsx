"use client";

import * as React from "react";

// The plasma-ring shader is adapted from react-bits' "Orb" background
// (https://reactbits.dev/backgrounds/orb, https://github.com/DavidHDev/react-bits).
// Copyright (c) 2026 David Haz — MIT License + Commons Clause v1.0. This notice is
// included per the MIT permission-notice requirement; use inside an application is
// permitted (the Commons Clause only restricts selling the component itself).
//
// Adaptations (owner iterations 2026-08-02): base colours are the app's marigold/
// honey/amber-ink instead of purple/cyan (set as shader constants — canvas paint,
// not DOM styling, PRN-12; the chrome around the orb uses tokens); the hover
// ripple is kept at a gentle 0.15 and applies only while the pointer is over the
// orb (upstream easing, hover-rotation stripped); the upstream "light background"
// branch is dropped — the ring renders with a transparent centre and composites
// onto any page, which is what keeps it vivid on the cream theme; raw WebGL
// replaces the `ogl` dependency (no new deps without an ADR); and the animation
// uses the shared pause-aware clock (tab-hidden pause, so returning never
// jump-cuts, + prefers-reduced-motion, which also disables the hover ripple).

const VERT = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform float iTime;
uniform vec3 iResolution;
uniform float hover;
uniform float hoverIntensity;
varying vec2 vUv;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    p3.x + p3.y,
    p3.x + p3.z,
    p3.y + p3.z
  ) * p3.zyx);
}

float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(
    dot(d0, d0),
    dot(d1, d1),
    dot(d2, d2),
    dot(d3, d3)
  ), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, hash33(i)),
    dot(d1, hash33(i + i1)),
    dot(d2, hash33(i + i2)),
    dot(d3, hash33(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

vec4 extractAlpha(vec3 colorIn) {
  float a = max(max(colorIn.r, colorIn.g), colorIn.b);
  return vec4(colorIn.rgb / (a + 1e-5), a);
}

// App palette (upstream: purple/cyan/deep-blue): marigold, light honey, amber ink.
const vec3 baseColor1 = vec3(0.878, 0.569, 0.169);
const vec3 baseColor2 = vec3(0.965, 0.722, 0.337);
const vec3 baseColor3 = vec3(0.561, 0.329, 0.086);
const float innerRadius = 0.6;
const float noiseScale = 0.65;

float light1(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * attenuation);
}

float light2(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * dist * attenuation);
}

vec4 draw(vec2 uv) {
  float ang = atan(uv.y, uv.x);
  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;

  float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0 * 1.05, r0, len);

  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

  float a = iTime * -1.0;
  vec2 pos = vec2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);

  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

  vec3 colBase = mix(baseColor1, baseColor2, cl);
  vec3 col = mix(baseColor3, colBase, v0);
  col = (col + v1) * v2 * v3;
  col = clamp(col, 0.0, 1.0);

  return extractAlpha(col);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 center = iResolution.xy * 0.5;
  float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;
  uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
  vec4 col = draw(uv);
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

/** Upstream default is 0.2; the owner asked for a touch gentler (0.1–0.2 range). */
const HOVER_INTENSITY = 0.15;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
}

export function Orb({ size, animate = false, className }: { size: number; animate?: boolean; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Size the canvas UNCONDITIONALLY (backing store + CSS) before touching the GL
    // context, so a no-WebGL environment (jsdom) still gets a correctly-sized element
    // and only skips the drawing.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true }) as WebGLRenderingContext | null;
    if (!gl) return; // jsdom / no WebGL — sized but not drawn; never throw

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // One fullscreen triangle (covers the viewport; uv runs past 1 on two verts).
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // interleaved: x, y, u, v
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "position");
    const aUv = gl.getAttribLocation(prog, "uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const uTime = gl.getUniformLocation(prog, "iTime");
    const uRes = gl.getUniformLocation(prog, "iResolution");
    const uHover = gl.getUniformLocation(prog, "hover");
    const uHoverIntensity = gl.getUniformLocation(prog, "hoverIntensity");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform3f(uRes, canvas.width, canvas.height, canvas.width / canvas.height);
    gl.uniform1f(uHover, 0);
    gl.uniform1f(uHoverIntensity, HOVER_INTENSITY);
    gl.clearColor(0, 0, 0, 0);

    // Deterministic per-size start phase (no Math.random) so multiple orbs don't
    // tick in perfect sync.
    const ph = ((size * 97) % 628) * 10;

    // Hover ripple eases toward the pointer state each drawn frame (upstream's
    // lerp), so it swells and settles instead of snapping.
    let targetHover = 0;
    let hoverVal = 0;

    const draw = (at: number) => {
      hoverVal += (targetHover - hoverVal) * 0.15;
      gl.uniform1f(uHover, hoverVal);
      gl.uniform1f(uTime, (at + ph) * 0.001);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moving = animate && !reduce;
    let raf = 0;
    // ~30fps cap keeps the always-on launcher cheap; the shader is time-driven.
    const FRAME_MS = 1000 / 30;
    // The clock ACCUMULATES only while the tab is visible — drawing from wall-clock
    // rAF timestamps after a hidden stretch jump-cuts (reads as a "reset").
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

    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener("visibilitychange", onVis);

    // Hover ripple only when the loop is running (a static/reduced-motion orb
    // has no frames to ease the ripple through — and shouldn't wiggle anyway).
    const onEnter = () => { targetHover = 1; };
    const onLeave = () => { targetHover = 0; };
    if (moving) {
      canvas.addEventListener("pointerenter", onEnter);
      canvas.addEventListener("pointerleave", onLeave);
    }

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [size, animate]);

  return (
    <span aria-hidden="true" className={"grid place-items-center rounded-full " + (className ?? "")}>
      <canvas ref={ref} className="block rounded-full" />
    </span>
  );
}
