export { compileSceneToGltf } from "./gltf.js";
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
