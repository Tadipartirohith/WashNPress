"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// One entrance per section, orchestrated rather than scattered. A section wraps its
// children in <ScrollReveal>; each direct child fades and slides up in turn, staggered
// by its index, the moment the group crosses into view. Honours reduced-motion by
// rendering everything already in place.
export function ScrollReveal({
  children,
  className,
  stagger = 90,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  as?: React.ElementType;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const items = React.Children.toArray(children);
  return (
    <Tag ref={ref} className={className}>
      {items.map((child, i) => (
        <div
          key={i}
          className={cn(
            "transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-6 opacity-0 blur-[2px]",
          )}
          style={{ transitionDelay: shown ? `${i * stagger}ms` : "0ms" }}
        >
          {child}
        </div>
      ))}
    </Tag>
  );
}
