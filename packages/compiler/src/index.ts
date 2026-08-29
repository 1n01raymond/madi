export { compileSceneToGltf } from "./gltf.js";
export { measureJsonDocument } from "./json-document.js";
export type { JsonByteSink, StreamedJsonDocument } from "./json-document.js";
export { streamJsonInto, streamJsonToString } from "./json-stream.js";
export type { JsonChunkSink, StreamJsonOptions } from "./json-stream.js";
export {
  compiledCacheEntrySchema,
  createCompiledCacheKey,
  currentCompilerCacheIdentity,
  publishCompiledCacheEntry,
  readCompiledCacheEntry,
  restoreCompiledCacheEntry,
} from "./compiled-cache.js";
export type {
  CompiledCacheEntry,
  CompiledCacheKeyInput,
  CompiledCacheResource,
  CompiledCacheSourceInput,
  CompiledCacheToolInput,
  CompilationCacheResult,
  PublishCompiledCacheEntryOptions,
  RestoreCompiledCacheEntryOptions,
} from "./compiled-cache.js";
export {
  defaultSpatialLeafCapacity,
  encodeSpatialDemandIndex,
  spatialDemandIndexSchema,
} from "./spatial-demand.js";
export type {
  EncodedSpatialDemandIndex,
  SpatialDemandIndexStats,
  SpatialDemandOccurrence,
  SpatialVector3,
} from "./spatial-demand.js";
export { compileIfcFederation } from "./ifc-federation.js";
export {
  createIfcIncrementalDependencyIndex,
  ifcIncrementalDependencyIndexSchema,
  planIfcIncrementalInvalidation,
  serializeIfcIncrementalDependencyIndex,
} from "./ifc-incremental-dependencies.js";
export type {
  IfcIncrementalDependencyIndex,
  IfcIncrementalDocumentDependency,
  IfcIncrementalInvalidationPlan,
  IfcIncrementalPrototypeDependency,
  IfcIncrementalSourceChange,
  IfcIncrementalSourceIdentity,
} from "./ifc-incremental-dependencies.js";
export { inspectIfcBytes, inspectIfcFile } from "./ifc-source.js";
export { writeCompiledPackage } from "./package-output.js";
export { compileStepFile } from "./step-compiler.js";
export { inspectStepBytes, inspectStepFile } from "./step-source.js";
export type { StepCompilationResult, StepCompileOptions } from "./step-compiler.js";
export type { StepSourceInspection, SupportedStepSchema } from "./step-source.js";
export type {
  IfcFederationCompilationResult,
  IfcFederationCompileOptions,
  IfcFederationDocumentInput,
  InspectedIfcFederationDocument,
} from "./ifc-federation.js";
export type { IfcSourceInspection, SupportedIfcSchema } from "./ifc-source.js";
export * from "./types.js";
export { validateCompiledGltf } from "./validate.js";
