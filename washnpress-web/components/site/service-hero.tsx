"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { MapPin, Truck } from "lucide-react";

// The hero visual, built around the real services rather than an abstract shape. Four
// glass tiles each animate the thing they represent: a washer drum turns, an iron
// breathes steam, a car takes water and foam, and a pressed shirt sways on a hanger.
// Motion is gentle, transform and opacity only, and it stops when reduced motion is set.

const loop = (extra: object = {}) => ({ repeat: Infinity, ease: "easeInOut", ...extra });

function WasherDrum({ animate }: { animate: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full text-primary" fill="none" aria-hidden="true">
      <rect x="8" y="6" width="48" height="52" rx="12" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
      <rect x="14" y="11" width="36" height="6" rx="3" fill="currentColor" opacity="0.28" />
      <circle cx="32" cy="37" r="16" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="32" cy="37" r="16" fill="currentColor" opacity="0.06" />
      <motion.g
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={animate ? { rotate: 360 } : {}}
        transition={loop({ duration: 6, ease: "linear" })}
      >
        <circle cx="32" cy="27.5" r="2.2" fill="currentColor" />
        <circle cx="41.5" cy="37" r="2.2" fill="currentColor" opacity="0.85" />
        <circle cx="32" cy="46.5" r="2.2" fill="currentColor" opacity="0.7" />
        <circle cx="22.5" cy="37" r="2.2" fill="currentColor" opacity="0.85" />
        <circle cx="38" cy="31" r="1.5" className="text-accent" fill="currentColor" />
        <circle cx="27" cy="43" r="1.5" className="text-accent" fill="currentColor" />
      </motion.g>
      <circle cx="46" cy="12.5" r="1.8" className="text-accent" fill="currentColor" />
    </svg>
  );
}

function SteamIron({ animate }: { animate: boolean }) {
  const wisp = (x: number, delay: number) => (
    <motion.path
      d={`M${x} 20 q -3 -5 0 -10`}
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-accent"
      initial={{ opacity: 0, y: 4 }}
      animate={animate ? { opacity: [0, 0.9, 0], y: [4, -8, -12] } : { opacity: 0.5 }}
      transition={loop({ duration: 2.2, delay })}
    />
  );
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full text-primary" fill="none" aria-hidden="true">
      {wisp(22, 0)} {wisp(32, 0.5)} {wisp(42, 1)}
      <path d="M12 44 h34 a10 10 0 0 0 10 -10 v-2 a2 2 0 0 0 -2 -2 H24 a12 12 0 0 0 -12 12 z" fill="currentColor" opacity="0.16" />
      <path d="M12 44 h34 a10 10 0 0 0 10 -10 v-2 a2 2 0 0 0 -2 -2 H24 a12 12 0 0 0 -12 12 z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M22 30 q 6 -8 18 -8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="12" y="47" width="40" height="4" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function CarWash({ animate }: { animate: boolean }) {
  const spray = (x: number, delay: number) => (
    <motion.line x1={x} y1="5" x2={x} y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      initial={{ opacity: 0, y: -4 }}
      animate={animate ? { opacity: [0, 0.85, 0], y: [-4, 14, 18] } : { opacity: 0.35 }}
      transition={loop({ duration: 1.5, delay })} />
  );
  const foam = (cx: number, r: number, delay: number) => (
    <motion.circle cx={cx} cy="47" r={r} fill="#cdfbf4"
      animate={animate ? { cy: [47, 33], opacity: [0.9, 0], scale: [1, 1.5] } : { opacity: 0.5 }}
      transition={loop({ duration: 2.2, delay })} />
  );
  const sparkle = (x: number, y: number, delay: number) => (
    <motion.path d={`M${x} ${y - 2.6} l0.8 1.8 l1.8 0.8 l-1.8 0.8 l-0.8 1.8 l-0.8 -1.8 l-1.8 -0.8 l1.8 -0.8 z`} fill="#ffffff"
      animate={animate ? { opacity: [0, 1, 0], scale: [0.5, 1, 0.5] } : { opacity: 0.6 }}
      transition={loop({ duration: 1.8, delay })} />
  );
  const body = "M6 46 v-4 c0 -3 2 -4 5 -4.6 l5 -1 c2 -5 6 -9 12 -9 h5 c6 0 9 3 11 8 l5 1 c3 0.6 5 1.6 5 4.6 v5 z";
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full text-primary" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wnp-carshine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="wnp-carbody"><path d={body} /></clipPath>
      </defs>
      {spray(20, 0)} {spray(32, 0.4)} {spray(44, 0.8)}
      <path d={body} fill="currentColor" opacity="0.16" />
      <path d={body} stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M20 31 c2 -4 5 -6 9 -6 h3 c4 0 6 2 8 5 z" fill="currentColor" opacity="0.28" />
      <line x1="30.5" y1="25" x2="30.5" y2="31.5" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
      <g clipPath="url(#wnp-carbody)">
        <motion.g animate={animate ? { x: [-26, 64] } : { x: 64 }} transition={loop({ duration: 1.5, repeatDelay: 2.2, ease: "easeInOut" })}>
          <rect x="0" y="18" width="16" height="34" transform="skewX(-16)" fill="url(#wnp-carshine)" />
        </motion.g>
      </g>
      {[18, 46].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="46" r="5.6" fill="#04201f" />
          <circle cx={cx} cy="46" r="5.6" stroke="currentColor" strokeWidth="2.4" />
          <motion.g style={{ transformBox: "fill-box", transformOrigin: "center" }} animate={animate ? { rotate: 360 } : {}} transition={loop({ duration: 1.8, ease: "linear" })}>
            <line x1={cx} y1="42.4" x2={cx} y2="49.6" stroke="currentColor" strokeWidth="1.5" />
            <line x1={cx - 3.6} y1="46" x2={cx + 3.6} y2="46" stroke="currentColor" strokeWidth="1.5" />
          </motion.g>
        </g>
      ))}
      {foam(13, 2.6, 0)} {foam(24, 2, 0.6)} {foam(40, 2.4, 1.1)} {foam(51, 1.8, 0.4)}
      {sparkle(48, 22, 0.3)} {sparkle(16, 26, 1.1)} {sparkle(35, 20, 1.9)}
    </svg>
  );
}

function Hanger({ animate }: { animate: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full text-primary" fill="none" aria-hidden="true">
      <motion.g
        style={{ transformBox: "fill-box", transformOrigin: "32px 12px" }}
        animate={animate ? { rotate: [-4, 4, -4] } : {}}
        transition={loop({ duration: 4 })}
      >
        <path d="M32 10 a3 3 0 1 1 3 3 h-3 z" stroke="currentColor" strokeWidth="2.2" />
        <path d="M14 26 L32 14 L50 26" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 28 q12 -10 24 0 l3 22 a3 3 0 0 1 -3 3 H20 a3 3 0 0 1 -3 -3 z" fill="currentColor" opacity="0.14" />
        <path d="M20 28 q12 -10 24 0 l3 22 a3 3 0 0 1 -3 3 H20 a3 3 0 0 1 -3 -3 z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M28 27 l4 5 l4 -5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="46" cy="24" r="1.8" className="text-accent" fill="currentColor" />
      </motion.g>
    </svg>
  );
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const tileIn: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.92 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 180, damping: 20 } },
};

function Tile({
  className, label, children, floatDelay, animate,
}: {
  className: string; label: string; children: React.ReactNode; floatDelay: number; animate: boolean;
}) {
  return (
    <motion.figure
      variants={tileIn}
      animate={animate ? { y: [0, -10, 0] } : undefined}
      transition={animate ? loop({ duration: 5, delay: floatDelay }) : undefined}
      className={`absolute flex flex-col items-center gap-1.5 rounded-3xl p-4 glass-strong ${className}`}
    >
      <span className="size-14 sm:size-16">{children}</span>
      <figcaption className="text-[11px] font-medium text-muted-foreground">{label}</figcaption>
    </motion.figure>
  );
}

export function ServiceHero() {
  const reduce = useReducedMotion();
  const animate = !reduce;
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative mx-auto h-[26rem] w-full max-w-md lg:h-[32rem]"
    >
      {/* soft brand halo behind the tiles */}
      <div className="pointer-events-none absolute inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />

      <Tile className="left-0 top-4 w-32" label="Laundry" floatDelay={0} animate={animate}><WasherDrum animate={animate} /></Tile>
      <Tile className="right-2 top-0 w-32" label="Steam ironing" floatDelay={0.8} animate={animate}><SteamIron animate={animate} /></Tile>
      <Tile className="left-6 bottom-24 w-32" label="Dry clean" floatDelay={1.4} animate={animate}><Hanger animate={animate} /></Tile>
      <Tile className="right-0 bottom-16 w-36" label="Car care" floatDelay={0.4} animate={animate}><CarWash animate={animate} /></Tile>

      {/* the live-order chip, the app's personality on the page */}
      <motion.div
        variants={tileIn}
        className="absolute bottom-0 left-1/2 w-64 -translate-x-1/2 rounded-2xl p-3.5 glass-strong"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Truck className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Order WNP-4821 · Car care</p>
            <p className="truncate text-sm font-medium">Foam wash in progress</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            initial={{ width: "12%" }}
            animate={animate ? { width: ["12%", "78%"] } : { width: "78%" }}
            transition={{ duration: 2.4, ease: "easeOut" }}
          />
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" /> At your bay, 6 minutes
        </p>
      </motion.div>
    </motion.div>
  );
}
