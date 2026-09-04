import { cn } from "@/lib/utils";

// A device mockup: a dark bezel with a notch and a rounded screen cutout. The screen
// is a flex column so an app can pin its own header and tab bar and scroll the middle.
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[380px] rounded-[3rem] border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-3 shadow-glass",
        "before:absolute before:inset-0 before:rounded-[3rem] before:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)] before:content-['']",
        className,
      )}
    >
      {/* side buttons */}
      <span aria-hidden className="absolute -left-1 top-28 h-14 w-1 rounded-l bg-white/10" />
      <span aria-hidden className="absolute -right-1 top-24 h-9 w-1 rounded-r bg-white/10" />
      <span aria-hidden className="absolute -right-1 top-36 h-14 w-1 rounded-r bg-white/10" />

      <div className="relative aspect-[9/19.3] overflow-hidden rounded-[2.25rem] bg-background ring-1 ring-white/10">
        {/* notch */}
        <div className="absolute left-1/2 top-2 z-30 flex h-7 w-32 -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-black/80">
          <span className="size-1.5 rounded-full bg-white/30" />
          <span className="h-1.5 w-8 rounded-full bg-white/10" />
        </div>
        <div className="flex h-full flex-col">{children}</div>
      </div>
    </div>
  );
}
