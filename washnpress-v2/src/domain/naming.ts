// What a society calls its towers, its floors and its flats.
//
// Every society was named the same way, by whatever the person filling in the
// form happened to type: one wrote "Tower A", the next "A", the next "Block-A",
// and the flats followed suit. Nothing was wrong with any of them individually —
// what was wrong was that the platform had no idea which one this society used,
// so it could not generate a name, could not check one, and could not tell two
// spellings of the same tower apart.
//
// A convention is a property of the society, so two societies may both have a
// Tower A and neither is a duplicate, while one society may not have two.
//
// These are choices from a short list rather than free-text templates. A template
// language would let an admin write something the platform then has to parse,
// validate and explain; the list covers what the societies here actually do, and
// a society that needs something else is a reason to extend the list rather than
// to invent a grammar.

export type TowerStyle = "letter" | "tower_letter" | "block_letter" | "number" | "tower_number";
export type FloorStyle = "number" | "ground_then_number" | "floor_number";
export type FlatStyle = "tower_floor_unit" | "floor_unit" | "tower_dash_unit";

export interface NamingConvention {
  tower: TowerStyle;
  floor: FloorStyle;
  flat: FlatStyle;
}

// What a society uses when nobody has said. It is the one already in the data:
// the seeded society has towers A, B and C and a resident at A-402.
export const DEFAULT_NAMING: NamingConvention = {
  tower: "letter",
  floor: "number",
  flat: "tower_floor_unit",
};

export const TOWER_STYLES: { value: TowerStyle; label: string; example: string }[] = [
  { value: "letter", label: "A, B, C", example: "A" },
  { value: "tower_letter", label: "Tower A, Tower B", example: "Tower A" },
  { value: "block_letter", label: "Block A, Block B", example: "Block A" },
  { value: "number", label: "1, 2, 3", example: "1" },
  { value: "tower_number", label: "Tower 1, Tower 2", example: "Tower 1" },
];

export const FLOOR_STYLES: { value: FloorStyle; label: string; example: string }[] = [
  { value: "number", label: "1, 2, 3", example: "3" },
  { value: "ground_then_number", label: "Ground, 1, 2", example: "Ground" },
  { value: "floor_number", label: "Floor 1, Floor 2", example: "Floor 3" },
];

export const FLAT_STYLES: { value: FlatStyle; label: string; example: string }[] = [
  { value: "tower_floor_unit", label: "A-301, A-302", example: "A-301" },
  { value: "floor_unit", label: "301, 302", example: "301" },
  { value: "tower_dash_unit", label: "A-1, A-2", example: "A-1" },
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The nth tower of a society, counting from one.
export function towerName(style: TowerStyle, index: number): string {
  // Past Z it keeps counting rather than wrapping back to A and producing a
  // duplicate: AA, AB, and so on.
  const letters = (n: number): string => {
    let out = "";
    let value = n;
    while (value > 0) {
      const rem = (value - 1) % 26;
      out = LETTERS[rem] + out;
      value = Math.floor((value - 1) / 26);
    }
    return out || "A";
  };
  switch (style) {
    case "letter": return letters(index);
    case "tower_letter": return `Tower ${letters(index)}`;
    case "block_letter": return `Block ${letters(index)}`;
    case "number": return String(index);
    case "tower_number": return `Tower ${index}`;
  }
}

// The nth floor, counting from one. "Ground" is the first floor where a society
// calls it that, and the numbering shifts down accordingly.
export function floorName(style: FloorStyle, index: number): string {
  switch (style) {
    case "number": return String(index);
    case "ground_then_number": return index === 1 ? "Ground" : String(index - 1);
    case "floor_number": return `Floor ${index}`;
  }
}

// The number a flat carries on a floor, before the tower is put in front of it.
// The first floor's flats are 101…, the second's 201…, and a ground floor's are
// 001… where the society names its ground floor.
function unitNumber(floorStyle: FloorStyle, floorIndex: number, position: number): string {
  const storey = floorStyle === "ground_then_number" ? floorIndex - 1 : floorIndex;
  return `${storey}${String(position).padStart(2, "0")}`;
}

// The name of one flat: which tower, which floor, and where along it.
export function flatName(
  convention: NamingConvention,
  towerIndex: number,
  floorIndex: number,
  position: number,
): string {
  const tower = towerName(convention.tower, towerIndex);
  // The letter or number alone, never "Tower A-301", which reads as a road.
  const short = tower.replace(/^(tower|block|wing|phase)\s*/i, "");
  switch (convention.flat) {
    case "tower_floor_unit": return `${short}-${unitNumber(convention.floor, floorIndex, position)}`;
    case "floor_unit": return unitNumber(convention.floor, floorIndex, position);
    case "tower_dash_unit": return `${short}-${position}`;
  }
}

// What the admin is shown before saving: the first few towers, their floors, and
// the flats on each — so a convention is chosen by looking at its result rather
// than by reading a label.
export function previewNaming(
  convention: NamingConvention,
  shape: { towers: number; floors: number; flatsPerFloor: number },
  limit = { towers: 2, floors: 3, flats: 4 },
): { tower: string; floors: { floor: string; flats: string[] }[] }[] {
  const towers = Math.min(shape.towers, limit.towers);
  return Array.from({ length: towers }, (_, t) => ({
    tower: towerName(convention.tower, t + 1),
    floors: Array.from({ length: Math.min(shape.floors, limit.floors) }, (_, f) => ({
      floor: floorName(convention.floor, f + 1),
      flats: Array.from(
        { length: Math.min(shape.flatsPerFloor, limit.flats) },
        (_, u) => flatName(convention, t + 1, f + 1, u + 1),
      ),
    })),
  }));
}

// Two names that are the same name.
//
// Compared without case and without surrounding space, because "Tower A", "tower
// a" and " Tower A " are one tower and letting them coexist is how a society ends
// up with two of everything.
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Whether a name is free within the list it is joining. `exceptId` lets a record
// keep its own name while being edited.
export function nameIsFree(
  existing: { id: string; name: string }[],
  name: string,
  exceptId?: string,
): boolean {
  return !existing.some((row) => row.id !== exceptId && sameName(row.name, name));
}

export function conventionProblems(convention: Partial<NamingConvention>): string[] {
  const problems: string[] = [];
  if (!TOWER_STYLES.some((s) => s.value === convention.tower)) problems.push("Choose how towers are named");
  if (!FLOOR_STYLES.some((s) => s.value === convention.floor)) problems.push("Choose how floors are named");
  if (!FLAT_STYLES.some((s) => s.value === convention.flat)) problems.push("Choose how flats are named");
  return problems;
}
