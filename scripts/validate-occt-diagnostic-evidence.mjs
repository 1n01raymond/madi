import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixtureId = "unsupported-layer-assignment";
const manifest = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../fixtures/step/manifest.json", import.meta.url)),
    "utf8",
  ),
);
const fixture = manifest.fixtures.find(({ id }) => id === fixtureId);
const fixturePath = fileURLToPath(
  new URL(`../fixtures/step/${fixture?.path ?? "missing"}`, import.meta.url),
);
const [fixtureBytes, scene, report, baselineReport] = await Promise.all([
  readFile(fixturePath),
  readFile(
    fileURLToPath(
      new URL(`../artifacts/occt/${fixtureId}.scene.json`, import.meta.url),
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(
    fileURLToPath(
      new URL(`../artifacts/occt/${fixtureId}.report.json`, import.meta.url),
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(
    fileURLToPath(
      new URL("../artifacts/occt/repeated-fasteners.report.json", import.meta.url),
    ),
    "utf8",
  ).then(JSON.parse),
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

assert(fixture, `Fixture ${fixtureId} is missing from the manifest.`);
assert(
  report.schemaVersion === "phase-0-occt-evidence.2",
  "Unsupported OCCT diagnostic evidence schema.",
);
const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
const fixtureText = fixtureBytes.toString("utf8");
assert(fixture.sha256 === fixtureDigest, "Fixture digest does not match the manifest.");
assert(report.source.sha256 === fixtureDigest, "Report source digest does not match fixture.");
assert(
  scene.revision.sourceDigest === `sha256:${fixtureDigest}`,
  "Scene revision digest does not match fixture.",
);
assert(
  scene.documents.length === 1 &&
    scene.documents[0].sourceDigest === `sha256:${fixtureDigest}`,
  "Scene document digest does not match fixture.",
);
assert(report.reader.status === "done" && report.reader.transfer === true, "OCCT transfer failed.");
assert(report.diagnostics.counts.error === 0, "Diagnostic evidence contains an error.");

const geometryCountKeys = [
  "partPrototypeCount",
  "partOccurrenceCount",
  "representationCount",
  "faceSourceCount",
  "edgeSourceCount",
  "triangleCount",
  "edgeSegmentCount",
];
for (const key of geometryCountKeys) {
  assert(
    report.counts[key] === baselineReport.counts[key],
    `Supported geometry count ${key} changed after adding unsupported metadata.`,
  );
}
assert(
  JSON.stringify(report.prototypeReuse) === JSON.stringify(baselineReport.prototypeReuse),
  "Prototype reuse changed after adding unsupported metadata.",
);

const sourceRefs = new Map(
  scene.documents.flatMap((document) =>
    document.sourceRefs.map((sourceRef) => [sourceRef.id, sourceRef]),
  ),
);
const expectedDiagnostics = fixture.expectedDiagnostics ?? [];
assert(expectedDiagnostics.length > 0, "Fixture has no expected diagnostics.");
const expectedEntityCount = expectedDiagnostics.reduce(
  (total, diagnostic) => total + diagnostic.count,
  0,
);
for (const expected of expectedDiagnostics) {
  const sourceEntityPattern = new RegExp(
    `^[ \\t]*#\\d+[ \\t]*=[ \\t]*${expected.entityType}\\s*\\(`,
    "gmu",
  );
  assert(
    [...fixtureText.matchAll(sourceEntityPattern)].length === expected.count,
    `${expected.entityType} count does not match the fixture contract.`,
  );
  const sceneMatches = scene.diagnostics.filter(
    ({ code, severity }) => code === expected.code && severity === expected.severity,
  );
  assert(
    sceneMatches.length === expected.count,
    `${expected.code} count does not match the fixture contract.`,
  );
  const reportMatches = report.diagnostics.unsupportedEntities.filter(
    ({ diagnosticCode, entityType }) =>
      diagnosticCode === expected.code && entityType === expected.entityType,
  );
  assert(
    reportMatches.length === expected.count,
    `${expected.code} is missing from the build report.`,
  );
  for (const reportMatch of reportMatches) {
    const reportSourceRef = sourceRefs.get(reportMatch.sourceRef);
    assert(
      reportSourceRef?.value === reportMatch.entityId,
      `${expected.code} build-report entity does not resolve through Scene IR.`,
    );
  }

  for (const diagnostic of sceneMatches) {
    assert(
      diagnostic.data?.entries?.entityType === expected.entityType,
      `${expected.code} has the wrong STEP entity type.`,
    );
    const sourceRef = sourceRefs.get(diagnostic.sourceRef);
    assert(sourceRef, `${expected.code} has an unresolved source reference.`);
    assert(
      sourceRef.namespace === "step:entity-instance" && /^#\d+$/u.test(sourceRef.value),
      `${expected.code} does not resolve to a STEP entity instance.`,
    );
    assert(
      reportMatches.some(({ sourceRef: reportSourceRef }) =>
        reportSourceRef === diagnostic.sourceRef
      ),
      `${expected.code} source reference differs between Scene IR and the build report.`,
    );
  }
}

const diagnosticCounts = { info: 0, warning: 0, error: 0 };
for (const diagnostic of scene.diagnostics) diagnosticCounts[diagnostic.severity] += 1;
assert(
  JSON.stringify(report.diagnostics.counts) === JSON.stringify(diagnosticCounts),
  "Scene and build-report diagnostic counts differ.",
);
const sceneCodes = [...new Set(scene.diagnostics.map(({ code }) => code))].sort();
assert(
  JSON.stringify(report.diagnostics.codes) === JSON.stringify(sceneCodes),
  "Scene and build-report diagnostic codes differ.",
);
assert(
  report.unsupportedEntityInspection.status === "reported" &&
    report.unsupportedEntityInspection.entityCount === expectedEntityCount,
  "Unsupported entity inspection is not recorded as reported.",
);

console.log(
  `[occt-diagnostics] verified ${expectedEntityCount} stable warning and preserved geometry`,
);
