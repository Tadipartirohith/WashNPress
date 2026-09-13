"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";

interface Bubble { x: number; y: number; r: number; v: number; p: number; a: number }

// Bubbles fade to nothing this close to the `clearAround` element, over this distance.
const CLEAR_GAP = 40;
const CLEAR_FADE = 24;

// Rising bubbles drawn on a canvas that fills its positioned parent. Decorative only.
// It draws one still frame under reduced motion, and stops drawing while it is off
// screen or the tab is hidden. Colours come from the --il-bub-* tokens, re-read when
// the theme class on <html> changes. `clearAround` keeps a bubble-free margin round
// an element, such as a sign-in card.
export function BubbleField({ density = 20, className, clearAround }: {
  density?: number; className?: string; clearAround?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const host = cv?.parentElement;
    const ctx = cv?.getContext("2d");
    if (!cv || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let w = 0, h = 0, raf = 0, last = 0, visible = true;
    let bubbles: Bubble[] = [];
    let ring = "", fill = "", hi = "";

    const colours = () => {
      const cs = getComputedStyle(host);
      ring = cs.getPropertyValue("--il-bub-ring").trim();
      fill = cs.getPropertyValue("--il-bub-fill").trim();
      hi = cs.getPropertyValue("--il-bub-hi").trim();
    };
    const spawn = (anywhere: boolean): Bubble => {
      const r = 3 + Math.pow(Math.random(), 2.2) * 20;
      return { x: Math.random() * w, y: anywhere ? Math.random() * h : h + r + Math.random() * 40, r, v: 0.18 + Math.random() * 0.45 + (8 / (r + 8)) * 0.25, p: Math.random() * 6.28, a: 0.3 + Math.random() * 0.6 };
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const clear = clearAround?.current?.getBoundingClientRect();
      const origin = clear ? cv.getBoundingClientRect() : null;
      for (const b of bubbles) {
        ctx.globalAlpha = 1;
        if (clear && origin) {
          // Distance from the bubble's edge to the element's box, in canvas space.
          const dx = Math.max(clear.left - origin.left - b.x, 0, b.x - (clear.right - origin.left));
          const dy = Math.max(clear.top - origin.top - b.y, 0, b.y - (clear.bottom - origin.top));
          const gap = Math.hypot(dx, dy) - b.r;
          if (gap <= CLEAR_GAP) continue;
          ctx.globalAlpha = Math.min(1, (gap - CLEAR_GAP) / CLEAR_FADE);
        }
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283);
        ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = 1.3; ctx.strokeStyle = ring; ctx.stroke();
        if (b.r > 6) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.62, 3.6, 4.5); ctx.lineWidth = 1.6; ctx.strokeStyle = hi; ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    };
    const resize = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      w = host.clientWidth; h = host.clientHeight;
      if (!w || !h) return;
      cv.width = Math.round(w * d); cv.height = Math.round(h * d); ctx.setTransform(d, 0, 0, d, 0, 0);
      // Capped so a very large screen does not draw hundreds of bubbles.
      const n = Math.min(160, Math.max(6, Math.round((density * w * h) / 120000)));
      bubbles = Array.from({ length: n }, () => spawn(true));
      colours(); draw();
    };
    const running = () => visible && !document.hidden && !reduce.matches;
    const tick = (t: number) => {
      raf = 0;
      const dt = Math.min(40, t - (last || t)); last = t;
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        b.y -= b.v * dt * 0.06; b.p += dt * 0.0016; b.x += Math.sin(b.p) * 0.25 * b.a;
        if (b.y < -b.r - 4) bubbles[i] = spawn(false);
      }
      draw();
      schedule();
    };
    function schedule() {
      if (running()) { if (!raf) raf = requestAnimationFrame(tick); }
      else { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
    }

    resize();
    schedule();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    // The clear zone follows the element when it changes size (a still frame redraws).
    const clearEl = clearAround?.current;
    if (clearEl) ro.observe(clearEl);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); });
    io.observe(cv);
    const mo = new MutationObserver(() => { colours(); draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", schedule);
    reduce.addEventListener("change", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      reduce.removeEventListener("change", schedule);
    };
  }, [density, clearAround]);

  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}
