import { describe, it, expect } from "vitest";
import { canTakeWork, operatorForBlock } from "../../src/domain/order-assignment";
import type { Block, User } from "../../src/domain/models";

function operator(id: string, overrides: Partial<User> = {}): User {
  return {
    id, phone: `98765${id}`, fullName: id, email: null, roles: ["operator"],
    status: "active", societyIds: ["soc-a"], blockIds: [], createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as User;
}

function block(operatorUserIds: string[]): Block {
  return {
    id: "blk-b", societyId: "soc-a", name: "B", flatCount: 40, floorCount: 10,
    operatorUserIds, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("who collects an order", () => {
  it("is whoever covers the tower it is collected from", () => {
    const people = new Map([["op-3", operator("op-3")]]);
    expect(operatorForBlock(block(["op-3"]), people)).toBe("op-3");
  });

  it("is nobody when the tower has nobody on it", () => {
    // Not "somebody in this society". Two towers of one society routinely have
    // different operators, so falling back to the society would be wrong about half
    // the time — and an order a supervisor has to assign by hand is a real state.
    expect(operatorForBlock(block([]), new Map())).toBeNull();
    expect(operatorForBlock(null, new Map())).toBeNull();
  });

  it("prefers the one on duty when a tower has two", () => {
    const people = new Map([
      ["op-away", operator("op-away", { status: "on_leave" })],
      ["op-here", operator("op-here")],
    ]);
    // Both keep the block — the assignment is what gets handed over when somebody
    // goes — but a new order should not land on the one who is away.
    expect(operatorForBlock(block(["op-away", "op-here"]), people)).toBe("op-here");
  });

  it("does not give work to an account that is no longer an operator", () => {
    const people = new Map([
      ["op-blocked", operator("op-blocked", { status: "blocked" })],
      ["op-new", operator("op-new", { verificationStatus: "pending" })],
      ["not-ops", operator("not-ops", { roles: ["resident"] })],
    ]);
    expect(operatorForBlock(block(["op-blocked", "op-new", "not-ops"]), people)).toBeNull();
    expect(canTakeWork(operator("op-away", { status: "on_leave" }))).toBe(true);
  });
});
