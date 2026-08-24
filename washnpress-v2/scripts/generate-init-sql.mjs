// Generates db/init.sql from the one authoritative schema, so the file Docker
// mounts on a fresh volume cannot drift from the one the application creates at
// startup. Run with `npm run schema:sql`; a test checks the result is committed.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schemaSql } from "../src/adapters/postgres/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const header = `-- GENERATED FILE. Do not edit by hand.
-- Source: src/adapters/postgres/schema.ts
-- Regenerate: npm run schema:sql
`;
writeFileSync(join(here, "..", "db", "init.sql"), `${header}\n${schemaSql()}\n`);
console.log("db/init.sql written from schemaSql()");
