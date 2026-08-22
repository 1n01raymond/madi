import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createIsometricCamera,
  hydrateEvidenceScene,
  prepareEvidenceScene,
} from "../src/evidence.js";

const evidenceUrl = new URL(
  "../../../artifacts/occt/repeated-fasteners.scene.json",
  import.meta.url,
);
const unsupportedEvidenceUrl = new URL(
  "../../../artifacts/occt/unsupported-layer-assignment.scene.json",
  import.meta.url,
);
const unsupportedReportUrl = new URL(
  "../../../artifacts/occt/unsupported-layer-assignment.report.json",
  import.meta.url,
);

async function loadEvidence() {
  return hydrateEvidenceScene(JSON.parse(await readFile(evidenceUrl, "utf8")));
}

describe("OCCT Scene IR evidence", () => {
  it("hydrates into a validator-clean scene with real prototype reuse", async () => {
    const prepared = prepareEvidenceScene(await loadEvidence());

    expect(prepared.scene.prototypes).toHaveLength(5);
    expect(prepared.scene.occurrences).toHaveLength(12);
    expect(prepared.gpuScene.batches).toHaveLength(3);
    expect(prepared.summary.partOccurrences).toBe(10);
    expect(prepared.summary.triangles).toBe(2076);
    expect(prepared.summary.edgeSegments).toBe(181);
    expect(Math.max(...prepared.gpuScene.batches.map(({ instances }) => instances.length))).toBe(
      8,
    );
    expect(new Set(prepared.objectLabels.keys()).size).toBe(10);
    expect(prepared.objectEvidence.get(5)).toMatchObject({
      label: "fastener-03",
      occurrenceId: "occurrence:madi-repeated-fasteners/fastener-bank/fastener-03",
      prototypeId: "prototype:part:fastener-01",
    });
    expect(prepared.objectEvidence.get(5)?.edgeSourceRefs.length).toBeGreaterThan(0);
    expect(
      prepared.objectEvidence
        .get(5)
        ?.edgeSourceRefs.every((sourceRef) => sourceRef.includes(":edge:")),
    ).toBe(true);
  });

  it("fits finite world bounds into an isometric WebGPU camera", async () => {
    const prepared = prepareEvidenceScene(await loadEvidence());
    const camera = createIsometricCamera(prepared.bounds, 16 / 9);

    expect(camera).toHaveLength(16);
    expect(Array.from(camera).every(Number.isFinite)).toBe(true);
    [-48, -28, 0].forEach((expected, axis) => {
      expect(prepared.bounds.min[axis]).toBeCloseTo(expected, 2);
    });
    [48, 28, 22].forEach((expected, axis) => {
      expect(prepared.bounds.max[axis]).toBeCloseTo(expected, 2);
    });
  });

  it("preserves supported geometry and resolves an unsupported STEP entity", async () => {
    const [scene, report] = await Promise.all([
      readFile(unsupportedEvidenceUrl, "utf8").then(JSON.parse).then(hydrateEvidenceScene),
      readFile(unsupportedReportUrl, "utf8").then(JSON.parse),
    ]);
    const prepared = prepareEvidenceScene(scene);
    const diagnostic = scene.diagnostics.find(
      ({ code }) => code === "OCCT_UNSUPPORTED_PRESENTATION_LAYER_ASSIGNMENT",
    );

    expect(prepared.scene.prototypes).toHaveLength(5);
    expect(prepared.summary.partOccurrences).toBe(10);
    expect(prepared.summary.triangles).toBe(2076);
    expect(diagnostic).toMatchObject({
      severity: "warning",
      data: {
        entries: {
          entityId: "#2135",
          entityType: "PRESENTATION_LAYER_ASSIGNMENT",
          handling: "omitted-semantic-metadata",
        },
      },
    });
    const sourceRef = scene.documents[0]?.sourceRefs.find(
      ({ id }) => id === diagnostic?.sourceRef,
    );
    expect(sourceRef).toMatchObject({
      namespace: "step:entity-instance",
      value: "#2135",
      kind: "property",
      stability: "revision-local",
    });
    expect(report.unsupportedEntityInspection).toMatchObject({
      status: "reported",
      entityCount: 1,
    });
    expect(report.diagnostics.counts).toEqual({ info: 1, warning: 1, error: 0 });
  });
});
