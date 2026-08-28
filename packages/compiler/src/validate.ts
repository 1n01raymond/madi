import {
  experimentalGltfProfile,
} from "./types.js";
import type {
  GltfDocument,
  PackageValidationIssue,
  PackageValidationResult,
} from "./types.js";

const componentBytes = new Map([
  [5121, 1],
  [5125, 4],
  [5126, 4],
]);
const typeComponents = new Map([
  ["SCALAR", 1],
  ["VEC3", 3],
]);

export function validateCompiledGltf(
  document: GltfDocument,
  binaryOrResources: Uint8Array | readonly Uint8Array[],
): PackageValidationResult {
  const resources = binaryOrResources instanceof Uint8Array
    ? [binaryOrResources]
    : binaryOrResources;
  const issues: PackageValidationIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (document.asset.version !== "2.0") {
    add("GLTF_VERSION", "asset.version", "The compiler profile requires glTF 2.0.");
  }
  const extras = document.extras.madi;
  if (
    typeof extras !== "object" ||
    extras === null ||
    !("profile" in extras) ||
    extras.profile !== experimentalGltfProfile
  ) {
    add("MADI_PROFILE", "extras.madi.profile", "The experimental MADI profile is missing.");
  }
  document.buffers.forEach((buffer, index) => {
    if (buffer.byteLength !== resources[index]?.byteLength) {
      add("BUFFER_LENGTH", `buffers[${index}]`, "Declared and actual binary lengths differ.");
    }
  });
  if (resources.length !== document.buffers.length) {
    add("BUFFER_COUNT", "buffers", "Declared and supplied binary resource counts differ.");
  }

  const positionAccessorIndexes = new Set(
    document.meshes.flatMap((mesh) =>
      mesh.primitives.flatMap((primitive) => {
        const position = primitive.attributes.POSITION;
        return position === undefined ? [] : [position];
      }),
    ),
  );

  document.bufferViews.forEach((bufferView, index) => {
    const path = `bufferViews[${index}]`;
    const binary = resources[bufferView.buffer];
    if (!document.buffers[bufferView.buffer] || !binary) {
      add("BUFFER_REFERENCE", `${path}.buffer`, "Unknown buffer.");
      return;
    }
    if (bufferView.byteOffset % 4 !== 0) {
      add("BUFFER_ALIGNMENT", `${path}.byteOffset`, "Buffer views must be 4-byte aligned.");
    }
    if (
      bufferView.byteLength <= 0 ||
      bufferView.byteOffset < 0 ||
      bufferView.byteOffset + bufferView.byteLength > binary.byteLength
    ) {
      add("BUFFER_RANGE", path, "Buffer view exceeds the binary resource.");
    }
  });

  document.accessors.forEach((accessor, index) => {
    const path = `accessors[${index}]`;
    const bufferView = document.bufferViews[accessor.bufferView];
    if (!bufferView) {
      add("ACCESSOR_BUFFER_VIEW", `${path}.bufferView`, "Unknown buffer view.");
      return;
    }
    const bytes = componentBytes.get(accessor.componentType);
    const components = typeComponents.get(accessor.type);
    if (!bytes || !components || accessor.count <= 0) {
      add("ACCESSOR_SHAPE", path, "Accessor shape or component type is invalid.");
      return;
    }
    if (accessor.count * bytes * components > bufferView.byteLength) {
      add("ACCESSOR_RANGE", path, "Accessor exceeds its buffer view.");
    }
    if (
      positionAccessorIndexes.has(index) &&
      (accessor.min?.length !== 3 || accessor.max?.length !== 3)
    ) {
      add("POSITION_BOUNDS", path, "Position accessors must declare min/max bounds.");
    }
  });

  document.meshes.forEach((mesh, meshIndex) => {
    if (mesh.primitives.length === 0) {
      add("MESH_EMPTY", `meshes[${meshIndex}]`, "Meshes must contain a primitive.");
    }
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const path = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      const position = document.accessors[primitive.attributes.POSITION ?? -1];
      if (!position || position.type !== "VEC3" || position.componentType !== 5126) {
        add("POSITION_ACCESSOR", `${path}.attributes.POSITION`, "Invalid position accessor.");
      }
      if (primitive.indices === undefined) {
        add("INDEX_ACCESSOR", `${path}.indices`, "The compiler profile requires indices.");
      } else {
        const indices = document.accessors[primitive.indices];
        if (!indices || indices.type !== "SCALAR" || indices.componentType !== 5125) {
          add("INDEX_ACCESSOR", `${path}.indices`, "Invalid uint32 index accessor.");
        } else if (
          (primitive.mode === 4 && indices.count % 3 !== 0) ||
          (primitive.mode === 1 && indices.count % 2 !== 0)
        ) {
          add("PRIMITIVE_COUNT", path, "Index count does not match primitive topology.");
        }
      }
      if (primitive.material !== undefined && !document.materials[primitive.material]) {
        add("MATERIAL_REFERENCE", `${path}.material`, "Unknown material.");
      }
    });
  });

  const parents = new Map<number, number>();
  document.nodes.forEach((node, nodeIndex) => {
    const path = `nodes[${nodeIndex}]`;
    if (
      node.matrix &&
      (node.matrix.length !== 16 || node.matrix.some((value) => !Number.isFinite(value)))
    ) {
      add("NODE_MATRIX", `${path}.matrix`, "Node matrix must contain 16 finite values.");
    }
    if (node.mesh !== undefined && !document.meshes[node.mesh]) {
      add("NODE_MESH", `${path}.mesh`, "Unknown mesh.");
    }
    const nodeMadi = node.extras?.madi;
    if (
      typeof nodeMadi === "object" &&
      nodeMadi !== null &&
      "coarseMesh" in nodeMadi &&
      (!Number.isInteger(nodeMadi.coarseMesh) ||
        !document.meshes[nodeMadi.coarseMesh as number])
    ) {
      add("NODE_COARSE_MESH", `${path}.extras.madi.coarseMesh`, "Unknown coarse mesh.");
    }
    for (const child of node.children ?? []) {
      if (!document.nodes[child]) {
        add("NODE_CHILD", `${path}.children`, `Unknown child node ${child}.`);
      } else if (parents.has(child)) {
        add("NODE_PARENT", `${path}.children`, `Node ${child} has multiple parents.`);
      } else {
        parents.set(child, nodeIndex);
      }
    }
  });

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (nodeIndex: number): void => {
    if (visiting.has(nodeIndex)) {
      add("NODE_CYCLE", `nodes[${nodeIndex}]`, "Node hierarchy contains a cycle.");
      return;
    }
    if (visited.has(nodeIndex) || !document.nodes[nodeIndex]) return;
    visiting.add(nodeIndex);
    for (const child of document.nodes[nodeIndex].children ?? []) visit(child);
    visiting.delete(nodeIndex);
    visited.add(nodeIndex);
  };
  for (const root of document.scenes[document.scene]?.nodes ?? []) visit(root);
  if (visited.size !== document.nodes.length) {
    add("NODE_REACHABILITY", "nodes", "Every node must be reachable from the default scene.");
  }

  return { ok: issues.length === 0, issues };
}
