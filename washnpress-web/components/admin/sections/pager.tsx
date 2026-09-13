"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Page } from "@/lib/api/admin";

// The "1–25 of 312" line and the previous/next buttons under a server-paged list. The
// total is the backend's count of everything the filters matched, so it stays true
// whichever page is on screen; the caller keeps its filters and only moves the offset.
export function Pager({ page, noun, onOffset }: { page: Page; noun: string; onOffset: (offset: number) => void }) {
  if (page.total === 0) return <p className="text-xs text-muted-foreground">0 {noun}</p>;
  const first = page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>{first}–{last} of {page.total} {noun}</span>
      <div className="flex gap-2">
        <button aria-label="Previous page" onClick={() => onOffset(Math.max(0, page.offset - page.limit))} disabled={page.offset === 0}
          className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronLeft className="size-4" /></button>
        <button aria-label="Next page" onClick={() => onOffset(page.offset + page.limit)} disabled={!page.hasMore}
          className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronRight className="size-4" /></button>
      </div>
    </div>
  );
}
