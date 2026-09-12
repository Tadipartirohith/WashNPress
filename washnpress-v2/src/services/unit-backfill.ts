import type { DataStore } from "../ports/repositories";
import { bareFlatNumber } from "../domain/unit";

// Flat numbers written before the tower became its own field.
//
// A resident used to be stored as "A-402" and a tower's flats could be named the same
// way, while every newer record says "402" and keeps the tower beside it. The two
// never compared equal, so an occupied flat read as free. Each old value is made bare
// here, once, on boot — the same way the assignment backfill gives old data its place
// — so nobody has to remember to run a script.
//
// Idempotent: a bare value stays bare, so a second run finds nothing to change.

export interface UnitBackfillReport {
  residentsMadeBare: number;
  blocksMadeBare: number;
}

export async function backfillBareFlatNumbers(store: DataStore): Promise<UnitBackfillReport> {
  const report: UnitBackfillReport = { residentsMadeBare: 0, blocksMadeBare: 0 };
  const blocks = await store.blocks.all();
  const blockNames = new Map(blocks.map((b) => [b.id, b.name]));

  for (const resident of await store.residents.all()) {
    if (!resident.unitNumber) continue;
    const tower = (resident.blockId ? blockNames.get(resident.blockId) : null) ?? resident.towerBlock;
    const bare = bareFlatNumber(resident.unitNumber, tower);
    if (bare && bare !== resident.unitNumber) {
      await store.residents.put({ ...resident, unitNumber: bare });
      report.residentsMadeBare += 1;
    }
  }

  for (const block of blocks) {
    if (!block.flats?.length) continue;
    const seen = new Set<string>();
    let changed = false;
    const flats = [];
    for (const flat of block.flats) {
      const bare = bareFlatNumber(flat.number, block.name) || flat.number;
      if (bare !== flat.number) changed = true;
      // "A-101" beside an existing "101" is the same flat written twice; keep one.
      if (seen.has(bare)) { changed = true; continue; }
      seen.add(bare);
      flats.push({ ...flat, number: bare });
    }
    if (changed) {
      await store.blocks.put({ ...block, flats, flatCount: flats.length });
      report.blocksMadeBare += 1;
    }
  }
  return report;
}
