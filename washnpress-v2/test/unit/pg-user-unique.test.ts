import { describe, it, expect } from "vitest";
import { createPostgresStore, type PgClient, type PgPool } from "../../src/adapters/postgres/store";
import { UniqueConstraintError } from "../../src/ports/repositories";
import type { User } from "../../src/domain/models";

// I-90. Two submissions of one phone number that pass the service's check together both
// reach the users table, and the unique index refuses the second. That refusal used to
// surface as a driver error and a 500; it is now the conflict it is.

// A pool that accepts the schema and refuses a users insert the way Postgres does when
// a unique index is hit.
function poolRefusing(constraint: string): PgPool {
  const query = async (text: string) => {
    if (text.trimStart().startsWith("INSERT INTO users")) {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint });
    }
    return { rows: [] };
  };
  const client: PgClient = { query, release() {} };
  return { query, connect: async () => client };
}

const user = {
  id: "u-dup", phone: "9876500099", email: "dup@example.com", fullName: null, employeeId: null,
  status: "active", roles: ["operator"], lastLoginAt: null, societyIds: [], createdAt: "2026-09-13T00:00:00.000Z",
} as unknown as User;

describe("a duplicate that reaches the users table", () => {
  it("is reported as the phone number it collided on", async () => {
    const store = await createPostgresStore(poolRefusing("uq_users_phone"));
    const failure = await store.users.put(user).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UniqueConstraintError);
    expect((failure as UniqueConstraintError).field).toBe("phone");
  });

  it("is reported as the email address it collided on", async () => {
    const store = await createPostgresStore(poolRefusing("uq_users_email"));
    const failure = await store.users.put(user).catch((e: unknown) => e);
    expect((failure as UniqueConstraintError).field).toBe("email");
  });

  it("leaves any other refusal as it was", async () => {
    const store = await createPostgresStore(poolRefusing("some_other_index"));
    const failure = await store.users.put(user).catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(UniqueConstraintError);
    expect((failure as Error).message).toMatch(/duplicate key/);
  });
});
