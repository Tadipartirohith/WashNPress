// What a dashboard should lead with.
//
// All four dashboards were the same shape: a vertical run of section headings,
// each followed by a grid of tiles, every tile the same size and weight. The
// operations one showed "Ready for delivery" in three separate grids; the admin
// one rendered the entire order state machine as fifteen equal squares. A screen
// where every number is equally prominent has not answered anything — it has
// deferred every question to the reader, who has to scan twenty tiles to find the
// one that is not zero.
//
// The restructure is the same in each portal and rests on three ideas.
//
//   Exceptions first, and only when they exist. The things that need a person are
//   a short list, and on a good day it is empty — which should read as "nothing is
//   wrong", not as a grid of zeroes.
//
//   The order pipeline is a flow, not a set. Fifteen counters cannot say where
//   work is piling up; the same fifteen numbers in the order the work moves
//   through them can, at a glance.
//
//   Reference figures are reference. How many towers a society has does not change
//   between logins and should not compete with a failed pickup for attention.

// ------------------------------------------------------------------ exceptions

export interface Exception {
  key: string;
  label: string;
  count: number;
  // How bad. Danger is somebody is already waiting; warn is somebody will be.
  tone: "danger" | "warn";
  // Where looking at it takes you.
  goto?: string;
}

// Only the ones that are actually happening, worst first, and the biggest of an
// equal pair before the smaller.
//
// The sort matters more than it looks: an operator with one failed pickup and
// forty pending ones needs the failure at the top, because the forty are ordinary
// and the one is not.
export function liveExceptions(candidates: Exception[]): Exception[] {
  return candidates
    .filter((e) => e.count > 0)
    .sort((a, b) => {
      if (a.tone !== b.tone) return a.tone === "danger" ? -1 : 1;
      return b.count - a.count;
    });
}

// What to say when there are none. Not an empty region: a screen that simply omits
// its most important section leaves the reader wondering whether it failed to
// load.
export function allClearLine(scope: string): string {
  return `Nothing needs attention in ${scope} right now.`;
}

// ------------------------------------------------------------------- pipeline

export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  // A stage nobody should be sitting in. QC hold is not a step of the process; it
  // is the process having stopped.
  stuck?: boolean;
  goto?: string;
}

// The stages in the order work actually moves through them, so a queue reads as a
// queue. Stages with nothing in them stay in the list — a gap in a flow is
// information, and removing it would make the pipeline reshuffle itself every
// time a number reached zero.
export function pipelineOf(counts: Record<string, number | undefined>): PipelineStage[] {
  const at = (key: string) => counts[key] ?? 0;
  return [
    { key: "scheduled", label: "Scheduled", count: at("scheduled"), goto: "scheduled" },
    { key: "picked_up", label: "Collected", count: at("pickedUp"), goto: "picked_up" },
    { key: "in_wash", label: "Washing", count: at("washing"), goto: "in_wash" },
    { key: "ironing", label: "Ironing", count: at("ironing"), goto: "ironing" },
    { key: "qc", label: "Quality check", count: at("qcPending"), goto: "qc" },
    { key: "qc_hold", label: "Failed QC", count: at("qcFailed"), stuck: true, goto: "qc_hold" },
    { key: "ready_for_delivery", label: "Ready", count: at("readyForDelivery"), goto: "ready_for_delivery" },
    { key: "out_for_delivery", label: "Out", count: at("outForDelivery"), goto: "out_for_delivery" },
  ];
}

// Where the work has banked up: the busiest stage that is not simply the start or
// the end of the line. Named on the screen so somebody reads one sentence instead
// of comparing eight numbers.
export function busiestStage(stages: PipelineStage[]): PipelineStage | null {
  const middle = stages.filter((s) => s.key !== "scheduled" && s.key !== "out_for_delivery");
  const busiest = middle.reduce<PipelineStage | null>(
    (worst, s) => (worst === null || s.count > worst.count ? s : worst),
    null,
  );
  return busiest && busiest.count > 0 ? busiest : null;
}

// How much is in the pipeline at all. A pipeline with nothing in it is worth
// saying so about rather than drawing as eight zeroes.
export function pipelineTotal(stages: PipelineStage[]): number {
  return stages.reduce((sum, s) => sum + s.count, 0);
}
