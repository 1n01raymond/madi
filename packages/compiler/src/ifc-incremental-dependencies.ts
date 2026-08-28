import type { EngineeringScene } from "@naru3d/scene-ir";

import type { GltfDocument } from "./types.js";

export const ifcIncrementalDependencyIndexSchema =
  "naru.ifc-incremental-dependency-index.1";

export interface IfcIncrementalSourceIdentity {
  readonly discipline: string;
  readonly sha256: string;
  readonly uriHint: string;
}

export interface IfcIncrementalDocumentDependency {
  readonly discipline: string;
  readonly documentId: string;
  readonly sourceDigest: string;
  readonly uriHint: string;
  readonly semanticIds: readonly string[];
  readonly prototypeIds: readonly string[];
  readonly occurrenceIds: readonly string[];
  readonly targetChunkIds: readonly string[];
  readonly reconciledDocumentIds: readonly string[];
}

export interface IfcIncrementalPrototypeDependency {
  readonly prototypeId: string;
  readonly documentIds: readonly string[];
  readonly targetChunkId?: string;
}

export interface IfcIncrementalDependencyIndex {
  readonly schemaVersion: typeof ifcIncrementalDependencyIndexSchema;
  readonly scene: {
    readonly sceneId: string;
    readonly revisionId: string;
    readonly sourceDigest: string;
    readonly packageDigest: string;
  };
  readonly documents: readonly IfcIncrementalDocumentDependency[];
  readonly prototypes: readonly IfcIncrementalPrototypeDependency[];
}

export type IfcIncrementalSourceChange =
  | {
      readonly kind: "added";
      readonly discipline: string;
      readonly sourceDigest: string;
      readonly uriHint: string;
    }
  | {
      readonly kind: "changed";
      readonly discipline: string;
      readonly previousSourceDigest: string;
      readonly sourceDigest: string;
    }
  | {
      readonly kind: "deleted";
      readonly discipline: string;
      readonly previousSourceDigest: string;
    }
  | {
      readonly kind: "renamed";
      readonly previousDiscipline: string;
      readonly discipline: string;
      readonly sourceDigest: string;
      readonly previousUriHint: string;
      readonly uriHint: string;
    };

export interface IfcIncrementalInvalidationPlan {
  readonly changes: readonly IfcIncrementalSourceChange[];
  readonly affectedDocumentIds: readonly string[];
  readonly affectedPrototypeIds: readonly string[];
  readonly affectedTargetChunkIds: readonly string[];
}

interface TargetChunk {
  readonly id: string;
  readonly prototypeIds: readonly string[];
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function asRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function targetChunks(document: GltfDocument): readonly TargetChunk[] {
  const rootExtras = asRecord(document.extras.madi, "glTF extras.madi");
  if (rootExtras.progressive === undefined) return [];
  const progressive = asRecord(rootExtras.progressive, "glTF progressive metadata");
  if (!Array.isArray(progressive.targetChunks)) {
    throw new TypeError("glTF progressive metadata must contain targetChunks.");
  }
  const ids = new Set<string>();
  return progressive.targetChunks.map((value, index) => {
    const chunk = asRecord(value, `glTF target chunk ${String(index)}`);
    if (typeof chunk.id !== "string" || chunk.id === "") {
      throw new TypeError(`glTF target chunk ${String(index)} has no stable id.`);
    }
    if (ids.has(chunk.id)) throw new TypeError(`Duplicate glTF target chunk id ${chunk.id}.`);
    ids.add(chunk.id);
    if (
      !Array.isArray(chunk.prototypeIds) ||
      chunk.prototypeIds.length === 0 ||
      chunk.prototypeIds.some((prototypeId) => typeof prototypeId !== "string")
    ) {
      throw new TypeError(`glTF target chunk ${chunk.id} has invalid prototypeIds.`);
    }
    return { id: chunk.id, prototypeIds: chunk.prototypeIds as readonly string[] };
  });
}

function sourceDigest(sha256: string): string {
  return sha256.startsWith("sha256:") ? sha256 : `sha256:${sha256}`;
}

function sourceDocumentByDiscipline(
  scene: EngineeringScene,
  sources: readonly IfcIncrementalSourceIdentity[],
) {
  const result = new Map<string, EngineeringScene["documents"][number]>();
  const claimed = new Set<string>();
  for (const source of [...sources].sort((left, right) =>
    compareText(left.discipline, right.discipline),
  )) {
    if (result.has(source.discipline)) {
      throw new TypeError(`Duplicate IFC discipline ${source.discipline}.`);
    }
    const expectedDigest = sourceDigest(source.sha256);
    const metadataMatch = scene.documents.find((document) =>
      document.metadata.entries.discipline === source.discipline &&
      document.sourceDigest === expectedDigest &&
      !claimed.has(document.id),
    );
    const digestMatches = scene.documents.filter((document) =>
      document.sourceDigest === expectedDigest && !claimed.has(document.id),
    );
    const document = metadataMatch ?? (digestMatches.length === 1 ? digestMatches[0] : undefined);
    if (!document) {
      throw new TypeError(
        `IFC Scene IR cannot uniquely map discipline ${source.discipline} to a source document.`,
      );
    }
    claimed.add(document.id);
    result.set(source.discipline, document);
  }
  if (claimed.size !== scene.documents.length) {
    throw new TypeError("IFC source identities do not cover every Scene IR document.");
  }
  return result;
}

function transitiveReconciliation(
  scene: EngineeringScene,
): ReadonlyMap<string, readonly string[]> {
  const documentBySemantic = new Map(
    scene.semantics.map((semantic) => [semantic.id as string, semantic.documentId as string]),
  );
  const graph = new Map(scene.documents.map((document) => [document.id as string, new Set<string>()]));
  for (const semantic of scene.semantics) {
    for (const relation of semantic.relationIds) {
      const targetDocumentId = documentBySemantic.get(relation.targetId);
      if (targetDocumentId && targetDocumentId !== semantic.documentId) {
        graph.get(semantic.documentId)?.add(targetDocumentId);
        graph.get(targetDocumentId)?.add(semantic.documentId);
      }
    }
  }
  return new Map([...graph].map(([documentId, adjacent]) => {
    const visited = new Set<string>([documentId]);
    const pending = [...adjacent];
    while (pending.length > 0) {
      const candidate = pending.pop() as string;
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      pending.push(...(graph.get(candidate) ?? []));
    }
    visited.delete(documentId);
    return [documentId, sorted(visited)] as const;
  }));
}

export function createIfcIncrementalDependencyIndex(
  scene: EngineeringScene,
  sources: readonly IfcIncrementalSourceIdentity[],
  document: GltfDocument,
  packageDigest: string,
): IfcIncrementalDependencyIndex {
  const sceneDocumentByDiscipline = sourceDocumentByDiscipline(scene, sources);
  const sourceRefDocument = new Map(
    scene.documents.flatMap((sourceDocument) =>
      sourceDocument.sourceRefs.map((sourceRef) => [sourceRef.id as string, sourceRef.documentId as string] as const),
    ),
  );
  const semanticDocument = new Map(
    scene.semantics.map((semantic) => [semantic.id as string, semantic.documentId as string]),
  );
  const representationByPrototype = new Map<
    string,
    Array<EngineeringScene["representations"][number]>
  >();
  for (const representation of scene.representations) {
    const representations = representationByPrototype.get(representation.prototypeId) ?? [];
    representations.push(representation);
    representationByPrototype.set(representation.prototypeId, representations);
  }
  const occurrenceByPrototype = new Map<
    string,
    Array<EngineeringScene["occurrences"][number]>
  >();
  for (const occurrence of scene.occurrences) {
    const occurrences = occurrenceByPrototype.get(occurrence.prototypeId) ?? [];
    occurrences.push(occurrence);
    occurrenceByPrototype.set(occurrence.prototypeId, occurrences);
  }

  const prototypeDocuments = new Map<string, Set<string>>();
  for (const prototype of scene.prototypes) {
    const documentIds = new Set<string>();
    const addSourceRef = (sourceRef: string | undefined): void => {
      const documentId = sourceRef === undefined ? undefined : sourceRefDocument.get(sourceRef);
      if (documentId) documentIds.add(documentId);
    };
    const addSemantic = (semanticId: string | undefined): void => {
      const documentId = semanticId === undefined ? undefined : semanticDocument.get(semanticId);
      if (documentId) documentIds.add(documentId);
    };
    addSourceRef(prototype.sourceRef);
    addSemantic(prototype.semanticId);
    for (const representation of representationByPrototype.get(prototype.id) ?? []) {
      for (const sourceRef of representation.sourceMap?.sourceRefs ?? []) addSourceRef(sourceRef);
    }
    for (const occurrence of occurrenceByPrototype.get(prototype.id) ?? []) {
      addSourceRef(occurrence.sourceRef);
      addSemantic(occurrence.semanticId);
    }
    if (documentIds.size === 0) {
      throw new TypeError(`Prototype ${prototype.id} has no source-document dependency.`);
    }
    prototypeDocuments.set(prototype.id, documentIds);
  }

  const chunkByPrototype = new Map<string, string>();
  for (const chunk of targetChunks(document)) {
    for (const prototypeId of chunk.prototypeIds) {
      if (chunkByPrototype.has(prototypeId)) {
        throw new TypeError(`Prototype ${prototypeId} belongs to more than one target chunk.`);
      }
      chunkByPrototype.set(prototypeId, chunk.id);
    }
  }
  const reconciliation = transitiveReconciliation(scene);
  const documents = [...sources]
    .sort((left, right) => compareText(left.discipline, right.discipline))
    .map((source) => {
      const sourceDocument = sceneDocumentByDiscipline.get(source.discipline);
      if (!sourceDocument) throw new TypeError(`Missing IFC discipline ${source.discipline}.`);
      const semanticIds = sorted(
        scene.semantics
          .filter(({ documentId }) => documentId === sourceDocument.id)
          .map(({ id }) => id),
      );
      const prototypeIds = sorted(
        [...prototypeDocuments]
          .filter(([, documentIds]) => documentIds.has(sourceDocument.id))
          .map(([prototypeId]) => prototypeId),
      );
      const occurrenceIds = sorted(scene.occurrences.flatMap((occurrence) => {
        const ownDocumentId =
          (occurrence.sourceRef ? sourceRefDocument.get(occurrence.sourceRef) : undefined) ??
          (occurrence.semanticId ? semanticDocument.get(occurrence.semanticId) : undefined);
        if (ownDocumentId) return ownDocumentId === sourceDocument.id ? [occurrence.id] : [];
        return prototypeDocuments.get(occurrence.prototypeId)?.has(sourceDocument.id)
          ? [occurrence.id]
          : [];
      }));
      const targetChunkIds = sorted(
        prototypeIds.flatMap((prototypeId) => {
          const chunkId = chunkByPrototype.get(prototypeId);
          return chunkId ? [chunkId] : [];
        }),
      );
      return {
        discipline: source.discipline,
        documentId: sourceDocument.id,
        sourceDigest: sourceDocument.sourceDigest,
        uriHint: source.uriHint,
        semanticIds,
        prototypeIds,
        occurrenceIds,
        targetChunkIds,
        reconciledDocumentIds: reconciliation.get(sourceDocument.id) ?? [],
      };
    });

  return {
    schemaVersion: ifcIncrementalDependencyIndexSchema,
    scene: {
      sceneId: scene.sceneId,
      revisionId: scene.revision.id,
      sourceDigest: scene.revision.sourceDigest,
      packageDigest,
    },
    documents,
    prototypes: [...prototypeDocuments]
      .sort(([left], [right]) => compareText(left, right))
      .map(([prototypeId, documentIds]) => ({
        prototypeId,
        documentIds: sorted(documentIds),
        ...(chunkByPrototype.has(prototypeId)
          ? { targetChunkId: chunkByPrototype.get(prototypeId) as string }
          : {}),
      })),
  };
}

export function serializeIfcIncrementalDependencyIndex(
  index: IfcIncrementalDependencyIndex,
): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function changeSortKey(change: IfcIncrementalSourceChange): string {
  return change.kind === "renamed"
    ? `${change.previousDiscipline}\u0000${change.discipline}\u0000${change.kind}`
    : `${change.discipline}\u0000${change.kind}`;
}

export function planIfcIncrementalInvalidation(
  previous: IfcIncrementalDependencyIndex,
  currentSources: readonly IfcIncrementalSourceIdentity[],
): IfcIncrementalInvalidationPlan {
  const currentByDiscipline = new Map<string, IfcIncrementalSourceIdentity>();
  for (const source of currentSources) {
    if (currentByDiscipline.has(source.discipline)) {
      throw new TypeError(`Duplicate IFC discipline ${source.discipline}.`);
    }
    currentByDiscipline.set(source.discipline, source);
  }
  const unmatchedCurrent = new Set(currentByDiscipline.keys());
  const changes: IfcIncrementalSourceChange[] = [];
  const invalidatedPreviousDisciplines = new Set<string>();
  const unmatchedPrevious: IfcIncrementalDocumentDependency[] = [];

  for (const document of previous.documents) {
    const current = currentByDiscipline.get(document.discipline);
    if (!current) {
      unmatchedPrevious.push(document);
      continue;
    }
    unmatchedCurrent.delete(document.discipline);
    const digest = sourceDigest(current.sha256);
    if (digest !== document.sourceDigest) {
      changes.push({
        kind: "changed",
        discipline: document.discipline,
        previousSourceDigest: document.sourceDigest,
        sourceDigest: digest,
      });
      invalidatedPreviousDisciplines.add(document.discipline);
    } else if (current.uriHint !== document.uriHint) {
      changes.push({
        kind: "renamed",
        previousDiscipline: document.discipline,
        discipline: document.discipline,
        sourceDigest: digest,
        previousUriHint: document.uriHint,
        uriHint: current.uriHint,
      });
      invalidatedPreviousDisciplines.add(document.discipline);
    }
  }

  const unmatchedPreviousDigestCounts = new Map<string, number>();
  for (const document of unmatchedPrevious) {
    unmatchedPreviousDigestCounts.set(
      document.sourceDigest,
      (unmatchedPreviousDigestCounts.get(document.sourceDigest) ?? 0) + 1,
    );
  }
  for (const document of unmatchedPrevious) {
    const renameCandidates = [...unmatchedCurrent]
      .map((discipline) => currentByDiscipline.get(discipline) as IfcIncrementalSourceIdentity)
      .filter((source) => sourceDigest(source.sha256) === document.sourceDigest);
    if (
      renameCandidates.length === 1 &&
      unmatchedPreviousDigestCounts.get(document.sourceDigest) === 1
    ) {
      const current = renameCandidates[0] as IfcIncrementalSourceIdentity;
      unmatchedCurrent.delete(current.discipline);
      changes.push({
        kind: "renamed",
        previousDiscipline: document.discipline,
        discipline: current.discipline,
        sourceDigest: document.sourceDigest,
        previousUriHint: document.uriHint,
        uriHint: current.uriHint,
      });
    } else {
      changes.push({
        kind: "deleted",
        discipline: document.discipline,
        previousSourceDigest: document.sourceDigest,
      });
    }
    invalidatedPreviousDisciplines.add(document.discipline);
  }
  for (const discipline of unmatchedCurrent) {
    const source = currentByDiscipline.get(discipline) as IfcIncrementalSourceIdentity;
    changes.push({
      kind: "added",
      discipline,
      sourceDigest: sourceDigest(source.sha256),
      uriHint: source.uriHint,
    });
  }
  changes.sort((left, right) => compareText(changeSortKey(left), changeSortKey(right)));

  const previousByDocumentId = new Map(
    previous.documents.map((document) => [document.documentId, document]),
  );
  const affectedDocumentIds = new Set<string>();
  for (const discipline of invalidatedPreviousDisciplines) {
    const document = previous.documents.find((candidate) => candidate.discipline === discipline);
    if (!document) continue;
    affectedDocumentIds.add(document.documentId);
    for (const reconciledDocumentId of document.reconciledDocumentIds) {
      affectedDocumentIds.add(reconciledDocumentId);
    }
  }
  const affectedPrototypeIds = new Set<string>();
  const affectedTargetChunkIds = new Set<string>();
  for (const documentId of affectedDocumentIds) {
    const document = previousByDocumentId.get(documentId);
    if (!document) continue;
    document.prototypeIds.forEach((prototypeId) => affectedPrototypeIds.add(prototypeId));
    document.targetChunkIds.forEach((chunkId) => affectedTargetChunkIds.add(chunkId));
  }
  return {
    changes,
    affectedDocumentIds: sorted(affectedDocumentIds),
    affectedPrototypeIds: sorted(affectedPrototypeIds),
    affectedTargetChunkIds: sorted(affectedTargetChunkIds),
  };
}
