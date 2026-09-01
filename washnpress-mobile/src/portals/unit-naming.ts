// Which floor, and which flat on it.
//
// Onboarding asked a new resident to choose their tower from a list and then to
// *type* their flat, so the one part of the address that decides who collects
// from them was free text: "A-402", "402", "a 402", "Flat 402" all arrived, and
// none of them could be checked against the tower they had just chosen.
//
// The towers themselves are records with a floor count and a flat count, which is
// enough to say what the floors are and what is on each. The convention is the
// one the platform already uses — the seeded resident lives at A-402, in tower A,
// on floor 4, in the second flat along — so a flat is its floor followed by its
// position on that floor, prefixed by the tower:
//
//   tower A · 10 floors · 40 flats  ->  4 flats a floor  ->  A-401 … A-410? no:
//                                                            A-401 … A-404
//
// Nothing here is hardcoded to a particular society: change the tower's counts and
// the lists change with it.

export interface BlockStructure {
  id: string;
  name: string;
  floorCount?: number;
  flatCount?: number;
}

// How many flats sit on each floor of this tower.
//
// Rounded up, because a tower of 10 floors and 41 flats has a floor with a spare
// one on it rather than a fractional flat. A tower with no floors recorded is one
// long floor.
export function flatsPerFloor(block: BlockStructure): number {
  const floors = block.floorCount ?? 0;
  const flats = block.flatCount ?? 0;
  if (flats <= 0) return 0;
  if (floors <= 0) return flats;
  return Math.ceil(flats / floors);
}

// The floors of a tower, as they are chosen: 1, 2, 3 …
//
// Ground floors are not invented. A society that calls its lowest floor Ground
// says so through the naming convention, which is configured per society; until
// it is, a floor is a number and the first one is 1.
export function floorsOf(block: BlockStructure | null | undefined): number[] {
  if (!block) return [];
  const floors = block.floorCount ?? 0;
  if (floors > 0) return Array.from({ length: floors }, (_, i) => i + 1);
  // A tower recorded before floors were asked for. One floor, holding everything.
  return (block.flatCount ?? 0) > 0 ? [1] : [];
}

// What a flat is called: the tower, the floor, and the position along it.
export function flatName(block: BlockStructure, floor: number, position: number): string {
  return `${block.name}-${floor}${String(position).padStart(2, "0")}`;
}

// The flats on one floor of one tower.
//
// The last floor carries the remainder rather than a full set, so a tower of 3
// floors and 10 flats gives 4, 4 and 2 — not 4, 4 and 4, which would offer two
// flats that do not exist.
export function flatsOn(block: BlockStructure | null | undefined, floor: number | null | undefined): string[] {
  if (!block || !floor) return [];
  const perFloor = flatsPerFloor(block);
  if (perFloor <= 0) return [];
  const total = block.flatCount ?? 0;
  const alreadyBelow = (floor - 1) * perFloor;
  const remaining = total - alreadyBelow;
  if (remaining <= 0) return [];
  const count = Math.min(perFloor, remaining);
  return Array.from({ length: count }, (_, i) => flatName(block, floor, i + 1));
}

// Whether a tower, floor and flat go together.
//
// The last line of defence on the client; the backend checks the same thing,
// because a screen is not where a rule lives.
export function unitIsValid(
  block: BlockStructure | null | undefined,
  floor: number | null | undefined,
  flat: string | null | undefined,
): boolean {
  if (!block || !floor || !flat) return false;
  return flatsOn(block, floor).includes(flat);
}
