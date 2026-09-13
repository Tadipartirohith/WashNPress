import { cn } from "@/lib/utils";

// The soft water edge where a tinted header meets what is below it. Place it inside a
// `relative overflow-hidden` block; colour it with a fill utility matching the ground
// below (fill-background by default). `animated` lets the water flow sideways.
export function WaveEdge({ animated = false, className }: { animated?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 800 26" preserveAspectRatio="none" aria-hidden="true" focusable="false"
      className={cn("wave-edge fill-background", animated && "wave-flow", className)}>
      <path d="M0 13 C30 1 100 25 150 13 S250 1 300 13 S370 25 400 13 S500 25 550 13 S650 1 700 13 S770 25 800 13 V26 H0Z" />
    </svg>
  );
}
