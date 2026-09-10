import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_TABLES, schemaSql } from "../../src/adapters/postgres/schema";

// Every table the Postgres store writes to has to exist.
//
// This is the test that was missing when a supervisor could not create a slot for a
// car wash. `store.ts` had bound a collection to `additional_service_slots` for as
// long as service slots had existed; `DOC_TABLES` had never listed it; so the table
// was never created and every write failed with `relation ... does not exist`, which
// reached the supervisor as "Something went wrong. The problem has been logged."
//
// The whole suite stayed green throughout, because it runs against the in-memory
// store where a collection needs no table. Only Postgres could see it, and nothing
// was asking Postgres. So the check cannot be another functional test — it has to
// read the store's own source and hold it against the schema.

const STORE = readFileSync(
  join(process.cwd(), "src/adapters/postgres/store.ts"),
  "utf8",
);

// Every table name handed to a collection in the Postgres store.
function tablesTheStoreUses(): string[] {
  const names = new Set<string>();
  // `new PgCollection<Thing>(pool, "table_name")` and its siblings.
  for (const m of STORE.matchAll(/new Pg[A-Za-z]*\w*\s*(?:<[^>]*>)?\s*\(\s*pool\s*,\s*"([a-z_]+)"/g)) {
    names.add(m[1]);
  }
  // Raw SQL against a table, for the repositories that are not collections.
  for (const m of STORE.matchAll(/(?:INSERT INTO|SELECT [^`]*?FROM|DELETE FROM|UPDATE)\s+([a-z_]+)/g)) {
    names.add(m[1]);
  }
  return [...names];
}

describe("the schema and the store agree", () => {
  it("creates a table for every collection the store binds", () => {
    const sql = schemaSql();
    const missing = tablesTheStoreUses().filter((t) => !sql.includes(t));
    // Named rather than counted: a failure here should say which table, because the
    // symptom at the other end is an unhandled 500 with no table in the message.
    expect(missing, `no CREATE TABLE for: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists the additional-service timetable, which it once did not", () => {
    // The specific regression. Kept as its own case so that deleting the table from
    // DOC_TABLES fails with the name of the thing that broke rather than a generic
    // drift message.
    expect(DOC_TABLES).toContain("additional_service_slots");
  });

  it("keeps db/init.sql in step with the schema it is generated from", () => {
    // A second hand-maintained copy is how the container came to start with tables
    // missing in the first place.
    const generated = schemaSql().trim();
    const onDisk = readFileSync(join(process.cwd(), "db/init.sql"), "utf8");
    for (const table of DOC_TABLES) {
      expect(onDisk, table).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(generated.length).toBeGreaterThan(0);
  });

  it("names no table twice", () => {
    expect(new Set(DOC_TABLES).size).toBe(DOC_TABLES.length);
  });
});
