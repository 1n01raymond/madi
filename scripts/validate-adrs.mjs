import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const adrDirectory = fileURLToPath(new URL("../docs/adr/", import.meta.url));
const indexText = await readFile(new URL("../docs/adr/README.md", import.meta.url), "utf8");
const validStatuses = new Set(["Proposed", "Accepted", "Superseded", "Rejected"]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

const filenames = (await readdir(adrDirectory))
  .filter((name) => /^\d{4}-[a-z0-9-]+\.md$/u.test(name))
  .sort();
const records = new Map();

for (const filename of filenames) {
  const text = await readFile(new URL(`../docs/adr/${filename}`, import.meta.url), "utf8");
  const heading = text.match(/^# ADR-(\d{4}): (.+)$/mu);
  const status = text.match(/^Status: (\S+)$/mu);
  assert(heading, `${filename} must start with a canonical ADR heading.`);
  assert(status && validStatuses.has(status[1]), `${filename} has an invalid status.`);
  assert(filename.startsWith(`${heading[1]}-`), `${filename} ID differs from its heading.`);

  const acceptedDate = text.match(/^Accepted: (\d{4}-\d{2}-\d{2})$/mu);
  const reviewedDate = text.match(/^Reviewed: (\d{4}-\d{2}-\d{2})$/mu);
  if (status[1] === "Accepted") {
    assert(acceptedDate, `${filename} must record its acceptance date.`);
  } else {
    assert(!acceptedDate, `${filename} is not Accepted but carries an acceptance date.`);
  }
  if (reviewedDate) {
    assert(status[1] === "Proposed", `${filename} review metadata is only used for Proposed ADRs.`);
  }

  records.set(heading[1], { filename, status: status[1] });
}

const indexRecords = new Map();
const indexRows = indexText.matchAll(
  /^\| \[(\d{4})\]\(([^)]+)\) \| .+ \| (Proposed|Accepted|Superseded|Rejected) \|$/gmu,
);
for (const row of indexRows) {
  assert(!indexRecords.has(row[1]), `ADR ${row[1]} appears twice in the index.`);
  indexRecords.set(row[1], { filename: row[2], status: row[3] });
}

assert(records.size > 0, "No ADR files were found.");
assert(indexRecords.size === records.size, "ADR index and file counts differ.");
for (const [id, record] of records) {
  const indexed = indexRecords.get(id);
  assert(indexed, `ADR ${id} is missing from the index.`);
  assert(indexed.filename === record.filename, `ADR ${id} index link is stale.`);
  assert(indexed.status === record.status, `ADR ${id} index status is stale.`);
}

const acceptedCount = [...records.values()].filter(({ status }) => status === "Accepted").length;
const proposedCount = [...records.values()].filter(({ status }) => status === "Proposed").length;
console.log(
  `[adrs] verified ${records.size} records (${acceptedCount} accepted, ${proposedCount} proposed)`,
);
