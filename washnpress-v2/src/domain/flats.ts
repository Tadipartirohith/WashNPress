import type { Flat } from "./models";

// Flats are numbered floor-first: floor 1 → 101, 102, …; floor 2 → 201, 202, …,
// which is the convention the ticket's example uses (Floor 1 → 101-104). A regenerate
// preserves the availability of any flat number that still exists, so toggling a flat
// inactive and later adding a floor never silently reactivates it.
export function generateFlats(
  floorCount: number,
  flatsPerFloor: number,
  existing: Flat[] = [],
): Flat[] {
  const prior = new Map(existing.map((f) => [f.number, f]));
  const out: Flat[] = [];
  for (let floor = 1; floor <= floorCount; floor += 1) {
    for (let i = 1; i <= flatsPerFloor; i += 1) {
      const number = String(floor * 100 + i);
      out.push({ floor, number, status: prior.get(number)?.status ?? "available" });
    }
  }
  return out;
}

// Groups a flat list into floors, in order, for a floor-by-floor display.
export function flatsByFloor(flats: Flat[]): { floor: number; flats: Flat[] }[] {
  const byFloor = new Map<number, Flat[]>();
  for (const f of flats) {
    const list = byFloor.get(f.floor) ?? [];
    list.push(f);
    byFloor.set(f.floor, list);
  }
  return [...byFloor.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([floor, fs]) => ({ floor, flats: fs.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })) }));
}
