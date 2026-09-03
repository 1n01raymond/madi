/**
 * Validates artifacts/import/structure-readiness: the ADR-0021 gate 0 record --
 * fresh-process, structure-only reads of every document in a federation, from
 * which the staged-preview design takes its one load-bearing number.
 *
 * Pins are deliberate. Everything a structure-only read produces is a function
 * of the file, so entry counts, payload bytes, and keyword counts are pinned
 * exactly and must not be retargeted to absorb a re-record; the timings are
 * host-dependent and are bounded rather than pinned, but the ratios the design
 * rests on (parsing dominates, the walk is negligible) are enforced, as are the
 * record's own verdicts against the product target, which is quoted from issue
 * #73 and may not be widened here to turn a miss into a pass.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordDirectory = resolve(repositoryRoot, "artifacts/import/structure-readiness");

const schemaVersion = "naru.structure-readiness.1";
const mode = "fresh-process-structure-only-federation-read";
const toolSchemaVersion = "naru.ifc-structure-readiness.1";
const manifestSha256 = "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478";
const makespanMethod = "longest-processing-time-first-schedule-of-measured-durations";
/** The product target of issue #73, restated so a record cannot widen it. */
const productTarget = { lowerSeconds: 5, upperSeconds: 15 };
const scanKeys = ["IFCRELAGGREGATES", "IFCRELCONTAINEDINSPATIALSTRUCTURE", "IFCBUILDINGSTOREY"];

const models = {
  "digital-hub": {
    datasetId: "ifc-bench-digital-hub",
    sourceBytes: 67829367,
    structureEntries: 4916,
    structurePayloadBytes: 598340,
    sequentialCeilingMilliseconds: 20000,
    slowestDiscipline: "heating",
    fastestDiscipline: "architecture",
    verdicts: { sequential: true, threaded: true, firstDocument: true },
    documents: {
      architecture: { schema: "IFC4", sourceBytes: 9022255, structureEntries: 783, structureRoots: 1, aggregateRelations: 14, containmentRelations: 3, structurePayloadBytes: 95294 },
      heating: { schema: "IFC4", sourceBytes: 20890415, structureEntries: 1801, structureRoots: 1, aggregateRelations: 3, containmentRelations: 3, structurePayloadBytes: 218151 },
      plumbing: { schema: "IFC4", sourceBytes: 25178864, structureEntries: 1016, structureRoots: 1, aggregateRelations: 3, containmentRelations: 3, structurePayloadBytes: 123951 },
      ventilation: { schema: "IFC4", sourceBytes: 12737833, structureEntries: 1316, structureRoots: 1, aggregateRelations: 3, containmentRelations: 3, structurePayloadBytes: 160944 },
    },
  },
  sixty5: {
    datasetId: "ifc-bench-sixty5",
    sourceBytes: 839866782,
    structureEntries: 76810,
    structurePayloadBytes: 10632098,
    sequentialCeilingMilliseconds: 180000,
    slowestDiscipline: "architecture",
    fastestDiscipline: "facade",
    verdicts: { sequential: false, threaded: false, firstDocument: true },
    documents: {
      architecture: { schema: "IFC2X3", sourceBytes: 342657851, structureEntries: 16534, structureRoots: 1, aggregateRelations: 20, containmentRelations: 19, structurePayloadBytes: 1760342 },
      electrical: { schema: "IFC2X3", sourceBytes: 97058912, structureEntries: 19897, structureRoots: 1, aggregateRelations: 3, containmentRelations: 19, structurePayloadBytes: 2750778 },
      facade: { schema: "IFC2X3", sourceBytes: 6067026, structureEntries: 1076, structureRoots: 1, aggregateRelations: 3, containmentRelations: 18, structurePayloadBytes: 112442 },
      kitchen: { schema: "IFC2X3", sourceBytes: 49670229, structureEntries: 3118, structureRoots: 1, aggregateRelations: 3, containmentRelations: 16, structurePayloadBytes: 319879 },
      plumbing: { schema: "IFC2X3", sourceBytes: 222099255, structureEntries: 22725, structureRoots: 1, aggregateRelations: 3, containmentRelations: 19, structurePayloadBytes: 3572885 },
      structure: { schema: "IFC2X3", sourceBytes: 7422441, structureEntries: 1404, structureRoots: 1, aggregateRelations: 3, containmentRelations: 19, structurePayloadBytes: 186296 },
      ventilation: { schema: "IFC2X3", sourceBytes: 114891068, structureEntries: 12056, structureRoots: 1, aggregateRelations: 3, containmentRelations: 19, structurePayloadBytes: 1929476 },
    },
  },
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const close = (actual, expected, tolerance, message) =>
  check(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

const isDistribution = (value) =>
  value !== null &&
  typeof value === "object" &&
  Array.isArray(value.values) &&
  ["median", "p95", "minimum", "maximum"].every((key) => typeof value[key] === "number");

for (const [modelId, expected] of Object.entries(models)) {
  const label = `[structure-readiness] ${modelId}`;
  const record = JSON.parse(await readFile(resolve(recordDirectory, `${modelId}.json`), "utf8"));
  check(record.schemaVersion === schemaVersion, `${label}: schemaVersion ${record.schemaVersion}`);
  check(record.mode === mode, `${label}: mode ${record.mode}`);
  check(record.model === modelId, `${label}: model ${record.model}`);
  check(record.tool?.schemaVersion === toolSchemaVersion, `${label}: tool schema ${record.tool?.schemaVersion}`);
  check(record.fixture?.datasetId === expected.datasetId, `${label}: dataset ${record.fixture?.datasetId}`);
  check(record.fixture?.manifest?.sha256 === manifestSha256, `${label}: manifest sha256 ${record.fixture?.manifest?.sha256}`);
  check(typeof record.commit?.head === "string" && record.commit.head.length === 40, `${label}: commit head missing`);
  check(typeof record.adapter?.fingerprint === "string" && record.adapter.fingerprint.length === 64, `${label}: adapter identity missing`);

  const disciplines = Object.keys(expected.documents);
  check(record.protocol?.sampleCount >= 5, `${label}: sampleCount ${record.protocol?.sampleCount} below the five the record declares`);
  check(record.protocol?.discardedSamples === 0, `${label}: discardedSamples ${record.protocol?.discardedSamples}`);
  check(record.samples?.length === record.protocol?.sampleCount, `${label}: ${record.samples?.length} samples for sampleCount ${record.protocol?.sampleCount}`);
  check(Array.isArray(record.protocol?.caveats) && record.protocol.caveats.length >= 3, `${label}: protocol caveats missing`);

  // Structure is a function of the file: pinned exactly, and identical in every sample.
  check(
    record.structure?.map((entry) => entry.discipline).join(",") === disciplines.join(","),
    `${label}: disciplines ${record.structure?.map((entry) => entry.discipline).join(",")}`,
  );
  let entrySum = 0;
  let payloadSum = 0;
  let sourceSum = 0;
  for (const discipline of disciplines) {
    const pinned = expected.documents[discipline];
    const entry = record.structure?.find((row) => row.discipline === discipline);
    if (!entry) {
      failures.push(`${label}: ${discipline} missing from structure`);
      continue;
    }
    for (const [key, value] of Object.entries(pinned)) {
      check(entry[key] === value, `${label}: ${discipline}.${key} ${entry[key]}, pinned ${value}`);
    }
    entrySum += entry.structureEntries;
    payloadSum += entry.structurePayloadBytes;
    sourceSum += entry.sourceBytes;
    check(
      scanKeys.every((key) => Number.isSafeInteger(entry.scanKeywordCounts?.[key])),
      `${label}: ${discipline} scan keyword counts incomplete`,
    );
    check(
      entry.scanKeywordCounts?.IFCRELCONTAINEDINSPATIALSTRUCTURE >= entry.containmentRelations,
      `${label}: ${discipline} counts fewer keyword hits than parsed containment relations`,
    );
    for (const [name, value] of Object.entries(entry.milliseconds ?? {})) {
      check(isDistribution(value), `${label}: ${discipline}.${name} is not a distribution`);
      check(value.values?.length === record.protocol?.sampleCount, `${label}: ${discipline}.${name} has ${value.values?.length} values`);
    }
    const source = record.fixture?.documents?.find((row) => row.discipline === discipline);
    check(source?.bytes === pinned.sourceBytes, `${label}: ${discipline} fixture bytes ${source?.bytes}`);
    check(typeof source?.sha256 === "string" && source.sha256.length === 64, `${label}: ${discipline} fixture sha256 missing`);
    for (const sample of record.samples ?? []) {
      const row = sample.documents?.find((candidate) => candidate.discipline === discipline);
      check(
        row?.structureEntries === pinned.structureEntries && row?.structurePayloadBytes === pinned.structurePayloadBytes,
        `${label}: sample ${sample.index} ${discipline} structure differs from the pinned shape`,
      );
      close(
        row?.readyMilliseconds,
        row?.openMilliseconds + row?.walkMilliseconds + row?.serializeMilliseconds,
        0.31,
        `${label}: sample ${sample.index} ${discipline} ready is not open+walk+serialize`,
      );
    }
  }
  check(entrySum === expected.structureEntries, `${label}: per-document entries sum to ${entrySum}, pinned ${expected.structureEntries}`);
  check(payloadSum === expected.structurePayloadBytes, `${label}: per-document payload sums to ${payloadSum}, pinned ${expected.structurePayloadBytes}`);
  check(sourceSum === expected.sourceBytes, `${label}: per-document source sums to ${sourceSum}, pinned ${expected.sourceBytes}`);

  // Federation aggregates, and the arithmetic that must hold between them.
  const federation = record.federation ?? {};
  check(federation.documentCount === disciplines.length, `${label}: documentCount ${federation.documentCount}`);
  check(federation.structureEntries === expected.structureEntries, `${label}: federation entries ${federation.structureEntries}`);
  check(federation.structurePayloadBytes === expected.structurePayloadBytes, `${label}: federation payload ${federation.structurePayloadBytes}`);
  check(federation.sourceBytes === expected.sourceBytes, `${label}: federation source bytes ${federation.sourceBytes}`);
  check(federation.makespanMethod === makespanMethod, `${label}: makespan method ${federation.makespanMethod}`);
  const times = federation.milliseconds ?? {};
  for (const [name, value] of Object.entries(times)) {
    check(isDistribution(value), `${label}: federation.${name} is not a distribution`);
  }
  // The federation aggregates hold per sample; a median of maxima is not a
  // maximum of medians, so the arithmetic is checked where it is exact.
  for (const sample of record.samples ?? []) {
    const rows = sample.documents ?? [];
    const ready = rows.map((row) => row.readyMilliseconds);
    const sampleFederation = sample.federation ?? {};
    close(
      sampleFederation.sequentialReadyMilliseconds,
      ready.reduce((total, value) => total + value, 0),
      0.11 * (ready.length + 1),
      `${label}: sample ${sample.index} sequential read is not the sum of its documents`,
    );
    close(sampleFederation.slowestDocumentReadyMilliseconds, Math.max(...ready), 0.11, `${label}: sample ${sample.index} slowest document`);
    close(sampleFederation.firstDocumentReadyMilliseconds, Math.min(...ready), 0.11, `${label}: sample ${sample.index} first document`);
    check(
      sampleFederation.estimatedThreadedMakespanMilliseconds >= Math.max(...ready) - 0.11,
      `${label}: sample ${sample.index} makespan ${sampleFederation.estimatedThreadedMakespanMilliseconds} is below its slowest document`,
    );
    check(
      sampleFederation.estimatedThreadedMakespanMilliseconds <= sampleFederation.sequentialReadyMilliseconds + 0.11,
      `${label}: sample ${sample.index} makespan exceeds its sequential read`,
    );
    check(
      sample.processMilliseconds >= sampleFederation.sequentialReadyMilliseconds,
      `${label}: sample ${sample.index} process wall is below its measured read`,
    );
  }
  const slowest = Math.max(...record.structure.map((row) => row.milliseconds.ready.median));
  const fastest = Math.min(...record.structure.map((row) => row.milliseconds.ready.median));
  check(
    record.structure.find((row) => row.discipline === expected.slowestDiscipline)?.milliseconds.ready.median === slowest,
    `${label}: slowest document is no longer ${expected.slowestDiscipline}`,
  );
  check(
    record.structure.find((row) => row.discipline === expected.fastestDiscipline)?.milliseconds.ready.median === fastest,
    `${label}: fastest document is no longer ${expected.fastestDiscipline}`,
  );
  check(
    times.sequentialReady?.median <= expected.sequentialCeilingMilliseconds,
    `${label}: sequential read ${times.sequentialReady?.median} ms exceeds the ${expected.sequentialCeilingMilliseconds} ms ceiling`,
  );
  check(
    federation.process?.median >= times.sequentialReady?.median,
    `${label}: process wall ${federation.process?.median} is below the measured read ${times.sequentialReady?.median}`,
  );

  // The reading the design rests on: parsing dominates, the walk is negligible.
  const findings = record.findings ?? {};
  const dominates = findings.parsingDominates ?? {};
  const parseSum = record.structure.reduce((total, row) => total + row.milliseconds.open.median, 0);
  const walkSum = record.structure.reduce((total, row) => total + row.milliseconds.walk.median, 0);
  close(dominates.parseMilliseconds, parseSum, 0.11, `${label}: findings parse total`);
  close(dominates.walkMilliseconds, walkSum, 0.11, `${label}: findings walk total`);
  close(dominates.parseShareOfReady, parseSum / times.sequentialReady.median, 0.0002, `${label}: parse share`);
  close(dominates.walkShareOfReady, walkSum / times.sequentialReady.median, 0.0002, `${label}: walk share`);
  check(dominates.parseShareOfReady >= 0.9, `${label}: parsing is only ${dominates.parseShareOfReady} of the path; the design rests on it dominating`);
  check(dominates.walkShareOfReady <= 0.05, `${label}: the containment walk is ${dominates.walkShareOfReady} of the path, no longer negligible`);
  check(
    findings.structureShareOfColdAdapter > 0 && findings.structureShareOfColdAdapter < 1,
    `${label}: structure share of the cold adapter ${findings.structureShareOfColdAdapter}`,
  );
  close(
    findings.structureShareOfColdAdapter,
    times.sequentialReady.median / findings.coldReference.cleanAdapterMilliseconds,
    0.0002,
    `${label}: structure share does not follow from the quoted cold reference`,
  );

  // The record's verdicts, against the target it quotes -- neither may be widened here.
  const target = findings.productTarget ?? {};
  check(target.lowerSeconds === productTarget.lowerSeconds && target.upperSeconds === productTarget.upperSeconds,
    `${label}: product target ${target.lowerSeconds}-${target.upperSeconds} s does not match issue #73`);
  const against = findings.againstProductTarget ?? {};
  const verdict = (seconds) => seconds <= productTarget.upperSeconds;
  check(against.sequentialWithinUpperBound === verdict(against.sequentialWholeFederationSeconds), `${label}: sequential verdict does not follow from its seconds`);
  check(against.estimatedThreadedWithinUpperBound === verdict(against.estimatedThreadedSeconds), `${label}: threaded verdict does not follow from its seconds`);
  check(against.firstDocumentWithinUpperBound === verdict(against.firstDocumentSeconds), `${label}: first-document verdict does not follow from its seconds`);
  check(against.sequentialWithinUpperBound === expected.verdicts.sequential, `${label}: sequential verdict ${against.sequentialWithinUpperBound}, pinned ${expected.verdicts.sequential}`);
  check(against.estimatedThreadedWithinUpperBound === expected.verdicts.threaded, `${label}: threaded verdict ${against.estimatedThreadedWithinUpperBound}, pinned ${expected.verdicts.threaded}`);
  check(against.firstDocumentWithinUpperBound === expected.verdicts.firstDocument, `${label}: first-document verdict ${against.firstDocumentWithinUpperBound}, pinned ${expected.verdicts.firstDocument}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `  ${failure}`).join("\n"));
  console.error(`[structure-readiness] ${failures.length} failure(s).`);
  process.exit(1);
}
console.log(
  `[structure-readiness] ${Object.keys(models).length} records: ` +
    Object.entries(models)
      .map(([id, m]) => `${id} ${Object.keys(m.documents).length} documents, ${m.structureEntries} entries, whole federation ${m.verdicts.sequential ? "within" : "outside"} the 5-15 s target`)
      .join("; "),
);
