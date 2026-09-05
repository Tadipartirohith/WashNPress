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
  const drop = (x: number, delay: number) => (
    <motion.line
      x1={x} y1="8" x2={x} y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-accent"
      initial={{ opacity: 0, y: -4 }}
      animate={animate ? { opacity: [0, 0.9, 0], y: [-4, 10, 14] } : { opacity: 0.4 }}
      transition={loop({ duration: 1.6, delay })}
    />
  );
  const foam = (cx: number, delay: number) => (
    <motion.circle
      cx={cx} cy="48" r="2.4" fill="currentColor" opacity="0.8"
      animate={animate ? { cy: [48, 40], opacity: [0.8, 0], scale: [1, 1.4] } : {}}
      transition={loop({ duration: 2, delay })}
    />
  );
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full text-primary" fill="none" aria-hidden="true">
      {drop(18, 0)} {drop(32, 0.4)} {drop(46, 0.8)}
      <path d="M10 44 l4 -12 a6 6 0 0 1 6 -4 h24 a6 6 0 0 1 6 4 l4 12" fill="currentColor" opacity="0.14" />
      <path d="M8 44 h48 v4 a3 3 0 0 1 -3 3 h-2 v-2 h-38 v2 h-2 a3 3 0 0 1 -3 -3 z" fill="currentColor" opacity="0.5" />
      <path d="M10 44 l4 -12 a6 6 0 0 1 6 -4 h24 a6 6 0 0 1 6 4 l4 12" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M22 30 h20 l2.5 8 h-25 z" fill="currentColor" opacity="0.2" />
      <circle cx="20" cy="48" r="3.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="44" cy="48" r="3.5" stroke="currentColor" strokeWidth="2.5" />
      {foam(16, 0)} {foam(28, 0.7)} {foam(40, 1.2)} {foam(50, 0.4)}
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
