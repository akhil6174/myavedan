/**
 * Validate a snapshot file against the schema. Used in CI and before every site build.
 *   npx tsx packages/schema/scripts/validate-snapshot.ts data/snapshot.json
 */
import { readFileSync } from "node:fs";
import { Snapshot } from "../src/types";

const file = process.argv[2] ?? "data/snapshot.json";
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`Could not read ${file}: ${(err as Error).message}`);
  process.exit(1);
}

const result = Snapshot.safeParse(raw);
if (!result.success) {
  console.error(`${file} is not a valid snapshot:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const { opportunities, sample } = result.data;
console.log(`${file} is valid: ${opportunities.length} opportunities${sample ? " (sample data)" : ""}.`);
