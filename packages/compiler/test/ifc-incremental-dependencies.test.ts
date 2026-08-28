import { createRepeatedTriangleScene, ids } from "@naru3d/scene-ir";
import type { EngineeringScene } from "@naru3d/scene-ir";
import { describe, expect, it } from "vitest";

import {
  compileSceneToGltf,
  createIfcIncrementalDependencyIndex,
  ifcIncrementalDependencyIndexSchema,
  planIfcIncrementalInvalidation,
} from "../src/index.js";
import type {
  IfcIncrementalDependencyIndex,
  IfcIncrementalSourceIdentity,
} from "../src/index.js";

const previous: IfcIncrementalDependencyIndex = {
  schemaVersion: ifcIncrementalDependencyIndexSchema,
  scene: {
    sceneId: "scene:previous",
    revisionId: "revision:previous",
    sourceDigest: "sha256:federation-previous",
    packageDigest: "package-previous",
  },
  documents: [
    {
      discipline: "architecture",
      documentId: "document:architecture",
      sourceDigest: "sha256:aaa",
      uriHint: "models/architecture.ifc",
      semanticIds: ["semantic:architecture"],
      prototypeIds: ["prototype:architecture"],
      occurrenceIds: ["occurrence:architecture"],
      targetChunkIds: ["target:architecture"],
      reconciledDocumentIds: ["document:structure"],
    },
    {
      discipline: "plumbing",
      documentId: "document:plumbing",
      sourceDigest: "sha256:ccc",
      uriHint: "models/plumbing.ifc",
      semanticIds: ["semantic:plumbing"],
      prototypeIds: ["prototype:plumbing"],
      occurrenceIds: ["occurrence:plumbing"],
      targetChunkIds: ["target:plumbing"],
      reconciledDocumentIds: [],
    },
    {
      discipline: "structure",
      documentId: "document:structure",
      sourceDigest: "sha256:bbb",
      uriHint: "models/structure.ifc",
      semanticIds: ["semantic:structure"],
      prototypeIds: ["prototype:structure"],
      occurrenceIds: ["occurrence:structure"],
      targetChunkIds: ["target:structure"],
      reconciledDocumentIds: ["document:architecture"],
    },
  ],
  prototypes: [
    {
      prototypeId: "prototype:architecture",
      documentIds: ["document:architecture"],
      targetChunkId: "target:architecture",
    },
    {
      prototypeId: "prototype:plumbing",
      documentIds: ["document:plumbing"],
      targetChunkId: "target:plumbing",
    },
    {
      prototypeId: "prototype:structure",
      documentIds: ["document:structure"],
      targetChunkId: "target:structure",
    },
  ],
};

function source(
  discipline: string,
  sha256: string,
  uriHint = `models/${discipline}.ifc`,
): IfcIncrementalSourceIdentity {
  return { discipline, sha256, uriHint };
}

describe("IFC incremental dependency invalidation", () => {
  it("derives transitive reconciliation dependencies from cross-document relations", () => {
    const base = createRepeatedTriangleScene();
    const architectureId = base.documents[0]?.id;
    const architectureSemantic = base.semantics[0];
    if (!architectureId || !architectureSemantic) {
      throw new TypeError("Repeated triangle fixture is incomplete.");
    }
    const structureId = ids.document("document:structure");
    const structureSemanticId = ids.semantic("semantic:structure");
    const scene: EngineeringScene = {
      ...base,
      revision: {
        ...base.revision,
        sourceDigest: "sha256:federation",
      },
      documents: [
        {
          ...base.documents[0],
          sourceDigest: "sha256:aaa",
          metadata: { entries: { discipline: "architecture" } },
        },
        {
          ...base.documents[0],
          id: structureId,
          displayName: "Structure",
          sourceDigest: "sha256:bbb",
          sourceRefs: [],
          metadata: { entries: { discipline: "structure" } },
        },
      ],
      semantics: [
        {
          ...architectureSemantic,
          relationIds: [{ type: "coordinates-with", targetId: structureSemanticId }],
        },
        {
          ...architectureSemantic,
          id: structureSemanticId,
          documentId: structureId,
          sourceRef: undefined,
          parentIds: [],
          relationIds: [{ type: "coordinates-with", targetId: architectureSemantic.id }],
        },
      ],
    };
    const compiled = compileSceneToGltf(scene, { coarseBounds: true });
    const index = createIfcIncrementalDependencyIndex(
      scene,
      [source("architecture", "aaa"), source("structure", "bbb")],
      compiled.document,
      compiled.report.output.packageDigest,
    );

    expect(index.documents).toMatchObject([
      {
        discipline: "architecture",
        reconciledDocumentIds: ["document:structure"],
      },
      {
        discipline: "structure",
        reconciledDocumentIds: [architectureId],
      },
    ]);
    expect(
      planIfcIncrementalInvalidation(index, [
        source("architecture", "changed"),
        source("structure", "bbb"),
      ]).affectedDocumentIds,
    ).toEqual([architectureId, "document:structure"]);
  });

  it("invalidates a changed document and its transitive reconciliation component", () => {
    const plan = planIfcIncrementalInvalidation(previous, [
      source("architecture", "changed"),
      source("plumbing", "ccc"),
      source("structure", "bbb"),
    ]);

    expect(plan.changes).toEqual([
      {
        kind: "changed",
        discipline: "architecture",
        previousSourceDigest: "sha256:aaa",
        sourceDigest: "sha256:changed",
      },
    ]);
    expect(plan.affectedDocumentIds).toEqual([
      "document:architecture",
      "document:structure",
    ]);
    expect(plan.affectedPrototypeIds).toEqual([
      "prototype:architecture",
      "prototype:structure",
    ]);
    expect(plan.affectedTargetChunkIds).toEqual([
      "target:architecture",
      "target:structure",
    ]);
  });

  it("classifies deleted and renamed documents without invalidating unrelated chunks", () => {
    const plan = planIfcIncrementalInvalidation(previous, [
      source("architecture", "aaa"),
      source("structure-core", "bbb", "models/structure-core.ifc"),
    ]);

    expect(plan.changes).toEqual([
      {
        kind: "deleted",
        discipline: "plumbing",
        previousSourceDigest: "sha256:ccc",
      },
      {
        kind: "renamed",
        previousDiscipline: "structure",
        discipline: "structure-core",
        sourceDigest: "sha256:bbb",
        previousUriHint: "models/structure.ifc",
        uriHint: "models/structure-core.ifc",
      },
    ]);
    expect(plan.affectedDocumentIds).toEqual([
      "document:architecture",
      "document:plumbing",
      "document:structure",
    ]);
    expect(plan.affectedPrototypeIds).toEqual([
      "prototype:architecture",
      "prototype:plumbing",
      "prototype:structure",
    ]);
  });

  it("treats a stable digest with a new URI hint as a rename", () => {
    const plan = planIfcIncrementalInvalidation(previous, [
      source("architecture", "aaa", "models/architecture-renamed.ifc"),
      source("plumbing", "ccc"),
      source("structure", "bbb"),
    ]);

    expect(plan.changes).toEqual([
      {
        kind: "renamed",
        previousDiscipline: "architecture",
        discipline: "architecture",
        sourceDigest: "sha256:aaa",
        previousUriHint: "models/architecture.ifc",
        uriHint: "models/architecture-renamed.ifc",
      },
    ]);
  });
});
