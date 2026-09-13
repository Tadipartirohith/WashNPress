"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The three service scenes (washer, iron, car) and the suds tint they sit on. All are
// decorative: aria-hidden, no text. Colours come only from the --il-* tokens in
// globals.css, so dark mode recolours the same drawings. Scenes are still unless
// `animated`; an animated scene pauses while it is off screen, and the CSS stops all
// of it under reduced motion.

export type ServiceTint = "laundry" | "iron" | "car";

interface SceneProps { animated?: boolean; className?: string }

// False while the element is off screen. Only observes when `enabled`.
function useOnScreen<T extends Element>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return [ref, onScreen] as const;
}

const ink: CSSProperties = { stroke: "var(--il-ink)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" };
const line = (width: number): CSSProperties => ({ stroke: "var(--il-ink)", strokeWidth: width });
const svgClass = (animated: boolean, onScreen: boolean, className?: string) =>
  cn("block h-auto w-full", animated && !onScreen && "il-paused", className);

export function Washer({ animated = false, className }: SceneProps) {
  const [ref, onScreen] = useOnScreen<SVGSVGElement>(animated);
  const clip = `wnp-drum-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const a = (c: string) => (animated ? c : undefined);
  return (
    <svg ref={ref} viewBox="0 0 240 240" aria-hidden="true" focusable="false" className={svgClass(animated, onScreen, className)}>
      <ellipse cx="120" cy="224" rx="80" ry="8" style={{ fill: "var(--il-shadow)" }} />
      <rect x="48" y="30" width="144" height="188" rx="18" style={{ fill: "var(--il-body)", ...ink }} />
      <line x1="48" y1="74" x2="192" y2="74" style={{ fill: "none", ...ink }} />
      <rect x="62" y="45" width="48" height="16" rx="8" style={{ fill: "var(--il-metal)" }} />
      <circle cx="156" cy="53" r="9" style={{ fill: "var(--il-metal)", ...ink }} />
      <circle cx="177" cy="53" r="4.5" style={{ fill: "var(--il-water2)" }} />
      <circle cx="120" cy="145" r="55" style={{ fill: "var(--il-metal)", ...ink }} />
      <clipPath id={clip}><circle cx="120" cy="145" r="43" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="70" y="95" width="100" height="100" style={{ fill: "var(--il-glass)" }} />
        <g className={a("il-spin")} style={{ transformOrigin: "120px 145px" }}>
          <rect x="92" y="112" width="34" height="18" rx="9" style={{ fill: "var(--il-shirt)", ...line(2) }} />
          <circle cx="146" cy="128" r="9" style={{ fill: "var(--il-water2)", ...line(2) }} />
          <rect x="112" y="160" width="26" height="14" rx="7" style={{ fill: "var(--il-foam)", ...line(2) }} />
        </g>
        <g className={a("il-sway")}>
          <path d="M50 152 Q70 140 90 152 T130 152 T170 152 T210 152 V200 H50Z" style={{ fill: "var(--il-water1)", opacity: 0.85 }} />
          <path d="M50 162 Q70 152 90 162 T130 162 T170 162 T210 162 V200 H50Z" style={{ fill: "var(--il-water2)", opacity: 0.9 }} />
        </g>
        <path d="M94 118 A34 34 0 0 1 120 107" style={{ fill: "none", stroke: "var(--il-foam)", strokeWidth: 5, strokeLinecap: "round", opacity: 0.9 }} />
      </g>
      <circle cx="120" cy="145" r="43" style={{ fill: "none", ...ink }} />
      <g className={a("il-bob")}>
        <circle cx="200" cy="36" r="14" style={{ fill: "var(--il-foam)", ...line(2.5) }} />
        <circle cx="195" cy="31" r="3.5" style={{ fill: "var(--il-water2)", opacity: 0.6 }} />
        <circle cx="219" cy="72" r="8" style={{ fill: "var(--il-foam)", ...line(2.5) }} />
        <circle cx="30" cy="104" r="10" style={{ fill: "var(--il-foam)", ...line(2.5) }} />
      </g>
      <circle cx="24" cy="66" r="5" style={{ fill: "none", stroke: "var(--il-water2)", strokeWidth: 2.5 }} />
      <circle cx="214" cy="116" r="4.5" style={{ fill: "none", stroke: "var(--il-water2)", strokeWidth: 2.5 }} />
    </svg>
  );
}

export function Iron({ animated = false, className }: SceneProps) {
  const [ref, onScreen] = useOnScreen<SVGSVGElement>(animated);
  const steam = (d: string, delay: number, stillOpacity: number) => (
    <path d={d} className={animated ? "il-steam" : undefined}
      style={{ fill: "none", stroke: "var(--il-steam)", strokeWidth: 4, strokeLinecap: "round", ...(animated ? { animationDelay: `${delay}s` } : { opacity: stillOpacity }) }} />
  );
  const handle = "M112 98 C112 72 124 64 144 64 L184 64 C193 64 197 71 195 79 L190 98";
  return (
    <svg ref={ref} viewBox="0 0 240 240" aria-hidden="true" focusable="false" className={svgClass(animated, onScreen, className)}>
      <ellipse cx="120" cy="222" rx="92" ry="8" style={{ fill: "var(--il-shadow)" }} />
      <rect x="34" y="156" width="172" height="58" rx="10" style={{ fill: "var(--il-shirt)", ...ink }} />
      <path d="M100 156 L120 178 L140 156" style={{ fill: "var(--il-foam)", ...ink }} />
      <circle cx="120" cy="192" r="3.5" style={{ fill: "var(--il-ink)" }} />
      <circle cx="120" cy="205" r="3.5" style={{ fill: "var(--il-ink)" }} />
      <path d={handle} style={{ fill: "none", stroke: "var(--il-ink)", strokeWidth: 11, strokeLinecap: "round" }} />
      <path d={handle} style={{ fill: "none", stroke: "var(--il-car)", strokeWidth: 5, strokeLinecap: "round" }} />
      <path d="M60 152 C64 116 94 98 134 98 L192 98 C200 98 206 104 206 112 L206 152 Z" style={{ fill: "var(--il-car)", ...ink }} />
      <rect x="54" y="148" width="158" height="11" rx="5.5" style={{ fill: "var(--il-metal)", ...ink }} />
      <circle cx="156" cy="124" r="10" style={{ fill: "var(--il-foam)", ...ink }} />
      <line x1="156" y1="124" x2="156" y2="117" style={{ fill: "none", stroke: "var(--il-ink)", strokeWidth: 2.5, strokeLinecap: "round" }} />
      {steam("M88 84 C80 72 96 64 88 50", 0, 0.8)}
      {steam("M70 92 C62 80 78 72 70 58", 0.7, 0.6)}
      {steam("M106 76 C98 64 114 56 106 42", 1.4, 0.7)}
      <path d="M190 170 L193 178 L201 181 L193 184 L190 192 L187 184 L179 181 L187 178Z" style={{ fill: "var(--il-spark)" }} />
    </svg>
  );
}

export function Car({ animated = false, className }: SceneProps) {
  const [ref, onScreen] = useOnScreen<SVGSVGElement>(animated);
  const spray: CSSProperties = { fill: "none", stroke: "var(--il-water2)", strokeWidth: 4, strokeLinecap: "round", ...(animated ? {} : { strokeDasharray: "10 9" }) };
  const foam: CSSProperties = { fill: "var(--il-foam)", ...line(2.5) };
  return (
    <svg ref={ref} viewBox="0 0 280 200" aria-hidden="true" focusable="false" className={svgClass(animated, onScreen, className)}>
      <ellipse cx="146" cy="176" rx="118" ry="7" style={{ fill: "var(--il-shadow)" }} />
      <path d="M8 30 Q58 16 96 58" className={animated ? "il-spray" : undefined} style={spray} />
      <path d="M8 46 Q50 40 80 76" className={animated ? "il-spray" : undefined} style={{ ...spray, opacity: 0.7 }} />
      <rect x="0" y="24" width="14" height="28" rx="5" style={{ fill: "var(--il-metal)", ...ink }} />
      <path d="M32 150 V128 C32 118 40 112 50 110 L88 104 L116 80 C122 75 130 72 138 72 L200 72 C210 72 218 76 224 84 L244 106 L256 110 C266 113 270 120 270 130 V150 C270 154 266 158 262 158 H40 C36 158 32 154 32 150Z" style={{ fill: "var(--il-car)", ...ink }} />
      <path d="M100 104 L122 84 C126 81 131 80 136 80 H164 V104Z" style={{ fill: "var(--il-glass)", ...line(2.5), strokeLinejoin: "round" }} />
      <path d="M172 80 H198 C205 80 211 83 215 89 L228 104 H172Z" style={{ fill: "var(--il-glass)", ...line(2.5), strokeLinejoin: "round" }} />
      <line x1="168" y1="106" x2="168" y2="150" style={{ fill: "none", ...line(2.5) }} />
      <rect x="178" y="114" width="14" height="4" rx="2" style={{ fill: "var(--il-ink)" }} />
      <rect x="254" y="118" width="12" height="8" rx="3" style={{ fill: "var(--il-spark)" }} />
      <circle cx="82" cy="156" r="20" style={{ fill: "var(--il-tyre)" }} />
      <circle cx="82" cy="156" r="8" style={{ fill: "var(--il-metal)" }} />
      <circle cx="218" cy="156" r="20" style={{ fill: "var(--il-tyre)" }} />
      <circle cx="218" cy="156" r="8" style={{ fill: "var(--il-metal)" }} />
      <g className={animated ? "il-bob" : undefined}>
        <circle cx="134" cy="68" r="12" style={foam} />
        <circle cx="154" cy="62" r="15" style={foam} />
        <circle cx="176" cy="66" r="12" style={foam} />
        <circle cx="194" cy="70" r="8" style={foam} />
        <circle cx="240" cy="100" r="9" style={foam} />
        <circle cx="54" cy="112" r="7" style={foam} />
      </g>
      <circle cx="112" cy="46" r="3.5" style={{ fill: "var(--il-water2)" }} />
      <circle cx="100" cy="30" r="2.5" style={{ fill: "var(--il-water2)" }} />
      <path d="M44 76 L47 83 L54 86 L47 89 L44 96 L41 89 L34 86 L41 83Z" style={{ fill: "var(--il-spark)" }} />
      <path d="M262 64 L264 69 L269 71 L264 73 L262 78 L260 73 L255 71 L260 69Z" style={{ fill: "var(--il-spark)" }} />
    </svg>
  );
}

// The suds ring pattern on a service tint. `drift` moves it slowly (large headers only)
// and pauses it off screen. The wrapper is aria-hidden only when it holds nothing but
// artwork; pass `decorative={false}` when real content sits inside it.
export function Suds({ tint = "laundry", drift = false, decorative = true, className, children }: {
  tint?: ServiceTint; drift?: boolean; decorative?: boolean; className?: string; children?: ReactNode;
}) {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>(drift);
  return (
    <div ref={ref} aria-hidden={decorative || undefined}
      className={cn("suds", drift && "suds-drift", drift && !onScreen && "il-paused", className)}
      style={{ "--il-tint": `var(--il-tint-${tint})` } as CSSProperties}>
      {children}
    </div>
  );
}
