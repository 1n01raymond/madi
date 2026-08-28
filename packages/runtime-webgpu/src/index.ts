export {
  addResidencyCost,
  alignedBufferByteLength,
  attachmentPairByteLength,
  batchResidencyCost,
  decodeObjectId,
  instanceStride,
  packInstanceData,
  packInstanceDataInto,
  splitFloat64,
  validateGpuScene,
  validatePrototypeBatch,
} from "./layout.js";
export type {
  BatchResidencyShape,
  GpuOccurrenceInstance,
  GpuPrototypeBatch,
  GpuScene,
  ResidencyCost,
} from "./layout.js";
export {
  CompiledGltfError,
  compiledSceneTransferables,
  decodeCompiledGltf,
  inspectCompiledHierarchy,
  parseCompiledGltf,
  prepareCompiledGltfDecoder,
} from "./compiled-gltf.js";
export {
  defaultCompiledPackageLimits,
  resolveCompiledPackageLimits,
} from "./package-limits.js";
export type {
  CompiledPackageLimitOverrides,
  CompiledPackageLimits,
  CompiledPackageOptions,
} from "./package-limits.js";
export {
  decodeSpatialDemandIndex,
  querySpatialDemandIndex,
  SpatialDemandIndexError,
  supportedSpatialDemandIndexSchema,
} from "./spatial-index.js";
export type {
  DecodedSpatialDemandIndex,
  DecodeSpatialDemandIndexOptions,
  SpatialDemandPriority,
  SpatialDemandQueryCandidate,
  SpatialDemandQueryFrame,
  SpatialDemandQueryOptions,
  SpatialDemandQueryResult,
} from "./spatial-index.js";
export type {
  CompiledGltfDocument,
  CompiledGltfErrorCode,
  CompiledBatchEvidence,
  DecodeCompiledGltfOptions,
  CompiledHierarchy,
  CompiledHierarchyEntry,
  CompiledObjectEvidence,
  CompiledPropertiesRef,
  CompiledSpatialIndexRef,
  CompiledTargetChunk,
  DecodedCompiledScene,
  GeometryRepresentation,
  PreparedCompiledGltfDecoder,
  SceneBounds,
} from "./compiled-gltf.js";
export {
  NaruWebGpuError,
  normalizeSectionPlane,
  rebaseSectionPlane,
  Phase0Renderer,
  Phase0Renderer as NaruWebGpuRenderer,
} from "./renderer.js";
export type {
  NaruWebGpuErrorCode,
  NormalizedSectionPlane,
  Phase0RendererOptions,
  Phase0RendererOptions as NaruWebGpuRendererOptions,
  GpuSceneBatchEntry,
  ReconcileSceneOptions,
  RenderOptions,
  RendererResourceStats,
  SectionPlane,
  SetSceneOptions,
} from "./renderer.js";
