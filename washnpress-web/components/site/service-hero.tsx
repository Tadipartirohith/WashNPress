"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { MapPin, Truck } from "lucide-react";
import { Washer } from "@/components/brand/illustrations";

// The hero visual: the washing machine scene on a soft halo, with the services it
// stands for named around it and the live-order chip below. The drum turns and the
// bubbles bob; the scene stops when reduced motion is set or it scrolls off screen.

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const tileIn: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.92 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 180, damping: 20 } },
};

function Tag({ className, label }: { className: string; label: string }) {
  return (
    <motion.span variants={tileIn}
      className={`absolute rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-glass ${className}`}>
      {label}
    </motion.span>
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
      {/* soft halo behind the machine */}
      <div className="pointer-events-none absolute inset-x-4 top-0 aspect-square rounded-full bg-[radial-gradient(circle,hsl(var(--card))_0%,transparent_70%)]" aria-hidden="true" />

      <div className="absolute inset-x-0 top-2 flex justify-center">
        <motion.div variants={tileIn} className="w-60 sm:w-64 lg:w-80">
          <Washer animated={animate} />
        </motion.div>
      </div>

      <Tag className="left-0 top-8" label="Laundry" />
      <Tag className="right-0 top-20" label="Steam ironing" />
      <Tag className="left-2 top-48 lg:top-60" label="Dry clean" />
      <Tag className="right-2 top-60 lg:top-72" label="Car care" />

      {/* the live-order chip, the app's personality on the page */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center">
        <motion.div variants={tileIn} className="w-64 rounded-2xl bg-card p-3.5 glass-strong">
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
      </div>
    </motion.div>
  );
}
