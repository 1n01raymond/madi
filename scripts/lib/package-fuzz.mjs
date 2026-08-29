/**
 * A deterministic malformed-package generator and outcome ledger.
 *
 * ADR-0011 bounds a compiled package before it is parsed or allocated. That
 * bound only means something if a malformed package leaves through the
 * declared failure contract rather than through whatever the first raw
 * dereference happens to throw, so this harness mutates a real committed
 * package and sorts every execution into `accepted`, `rejected`, or
 * `uncontrolled`.
 *
 * It deliberately imports nothing from the runtime: the caller injects the
 * loader chain, which lets the evidence recorder drive the built package while
 * a unit test drives the same campaign against the sources.
 */

/** Deterministic 32-bit PRNG (mulberry32); the same seed replays a campaign. */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a label, so a target's seeds do not depend on its position. */
export function seedFromLabel(label, seed) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let at = 0; at < label.length; at += 1) {
    hash = (hash ^ label.charCodeAt(at)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Members reachable from the roots that decide what the loader allocates. An
 * earlier campaign that mutated the whole document spent itself on inert
 * metadata and found nothing; restricting the walk is what makes the budget
 * land on the readers under test.
 */
export const defaultDocumentRoots = Object.freeze([
  "accessors",
  "asset",
  "bufferViews",
  "buffers",
  "extras",
  "materials",
  "meshes",
  "nodes",
  "scene",
  "scenes",
]);

const defaultMaximumDepth = 12;

/** @returns {(string | number)[][]} Every member path a mutation may target. */
export function enumerateMutablePaths(value, options = {}) {
  const roots = options.roots ?? defaultDocumentRoots;
  const maximumDepth = options.maximumDepth ?? defaultMaximumDepth;
  /** @type {(string | number)[][]} */
  const found = [];
  const walk = (node, path) => {
    if (path.length > maximumDepth) return;
    found.push(path);
    if (Array.isArray(node)) {
      for (const [at, child] of node.entries()) walk(child, [...path, at]);
    } else if (node && typeof node === "object") {
      for (const key of Object.keys(node)) walk(node[key], [...path, key]);
    }
  };
  if (!value || typeof value !== "object") return [[]];
  found.push([]);
  for (const root of roots) {
    if (root in value) walk(value[root], [root]);
  }
  return found;
}

function valueAt(root, path) {
  let current = root;
  for (const key of path) current = current?.[key];
  return current;
}

function assignAt(root, path, value) {
  if (path.length === 0) return;
  const parent = valueAt(root, path.slice(0, -1));
  if (parent && typeof parent === "object") parent[path[path.length - 1]] = value;
}

function removeAt(root, path) {
  if (path.length === 0) return;
  const parent = valueAt(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (parent && typeof parent === "object") delete parent[last];
}

/** Values a hostile package can put anywhere a number or object is expected. */
export const poisonValues = Object.freeze([
  null, 0, -1, 1, 1.5, -0.5, 2 ** 53, Number.MAX_SAFE_INTEGER, -(2 ** 31),
  1e308, "", "x".repeat(64), "0", true, false, [], {}, [0], [[]], { a: 1 },
  4294967296, 65535, 5121, 5126,
]);

export const documentOperators = Object.freeze([
  "replace", "delete", "duplicate", "truncate", "swap", "scale", "retype", "chain",
]);

const scaleFactors = [1e6, -1, 1e-9, 2 ** 31];

/**
 * Applies one operator in place and names what it did. An operator that finds
 * nothing of its kind at the drawn path reports `<name>-noop` rather than
 * retrying, so the operator histogram stays an honest account of the campaign.
 */
export function mutateDocument(document, random, options = {}) {
  const paths = enumerateMutablePaths(document, options);
  const path = paths[Math.floor(random() * paths.length)] ?? [];
  const operator = documentOperators[Math.floor(random() * documentOperators.length)];
  const target = valueAt(document, path);
  switch (operator) {
    case "replace":
      assignAt(document, path, poisonValues[Math.floor(random() * poisonValues.length)]);
      return { operator, path };
    case "delete":
      removeAt(document, path);
      return { operator, path };
    case "duplicate":
      if (Array.isArray(target) && target.length > 0) {
        target.push(structuredClone(target[Math.floor(random() * target.length)]));
        return { operator, path };
      }
      return { operator: "duplicate-noop", path };
    case "truncate":
      if (Array.isArray(target) && target.length > 0) {
        target.length = Math.floor(random() * target.length);
        return { operator, path };
      }
      return { operator: "truncate-noop", path };
    case "swap":
      if (Array.isArray(target) && target.length > 1) {
        const left = Math.floor(random() * target.length);
        const right = Math.floor(random() * target.length);
        [target[left], target[right]] = [target[right], target[left]];
        return { operator, path };
      }
      return { operator: "swap-noop", path };
    case "scale":
      if (typeof target === "number") {
        assignAt(document, path, target * scaleFactors[Math.floor(random() * scaleFactors.length)]);
        return { operator, path };
      }
      return { operator: "scale-noop", path };
    case "retype":
      if (typeof target === "number") {
        assignAt(document, path, String(target));
        return { operator, path };
      }
      if (typeof target === "string") {
        assignAt(document, path, target.length);
        return { operator, path };
      }
      return { operator: "retype-noop", path };
    case "chain": {
      // A hostile node graph is the one shape random member edits never reach:
      // the traversal bound is the only thing standing between a deep chain and
      // the stack.
      if (!Array.isArray(document.nodes) || document.nodes.length === 0) {
        return { operator: "chain-noop", path };
      }
      const depth = 1 + Math.floor(random() * 200);
      document.nodes = Array.from({ length: depth }, (_unused, at) => (
        at + 1 < depth ? { children: [at + 1] } : {}
      ));
      document.scenes = [{ nodes: [0] }];
      document.scene = 0;
      return { operator, path: ["nodes"] };
    }
    default:
      return { operator: "none", path };
  }
}

export const binaryOperators = Object.freeze(["intact", "truncate", "flip", "grow"]);

/** Returns a fresh buffer; the seed bytes are never mutated. */
export function mutateBinary(bytes, random) {
  const operator = binaryOperators[Math.floor(random() * binaryOperators.length)] ?? "intact";
  if (operator === "truncate") {
    const length = Math.floor(random() * bytes.byteLength);
    return { operator, bytes: bytes.slice(0, length) };
  }
  if (operator === "flip") {
    const copy = bytes.slice();
    const flips = 1 + Math.floor(random() * 8);
    for (let at = 0; at < flips; at += 1) {
      copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
    }
    return { operator, bytes: copy };
  }
  if (operator === "grow") {
    const grown = new Uint8Array(bytes.byteLength + 1 + Math.floor(random() * 64));
    grown.set(bytes);
    return { operator, bytes: grown };
  }
  return { operator, bytes: bytes.slice() };
}

/**
 * Sorts one execution's failure. `rejected` means the reader refused through a
 * declared error class; anything else is `uncontrolled` -- the reader crashed
 * somewhere it never promised to, which is the defect this campaign hunts.
 */
export function classifyOutcome(error, controlledErrorNames) {
  const name = error instanceof Error ? error.name : typeof error;
  if (controlledErrorNames.includes(name)) {
    const code = error.code;
    return { outcome: "rejected", detail: typeof code === "string" ? code : name };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { outcome: "uncontrolled", detail: normalizeDetail(`${name}: ${message}`) };
}

/** Collapses run-specific numbers so one defect counts as one kind. */
export function normalizeDetail(detail) {
  return detail.replace(/[0-9]+/gu, "N").slice(0, 160);
}

function tally(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCounts(counts) {
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, "en")));
}

/**
 * Runs every target for `iterations` mutated executions and returns a ledger
 * that a validator can pin. Nothing here is timing-dependent, so the same seed
 * reproduces the same counts on any host.
 */
export function runPackageFuzzCampaign(options) {
  const {
    targets,
    iterations,
    seed = 1,
    controlledErrorNames,
    maximumDocumentMutations = 3,
    maximumSamples = 12,
  } = options;
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new TypeError("A fuzz campaign needs a positive iteration count.");
  }
  const recorded = [];
  const samples = [];
  for (const target of targets) {
    const documentOperatorCounts = new Map();
    const binaryOperatorCounts = new Map();
    const rejectionCounts = new Map();
    const uncontrolledCounts = new Map();
    let accepted = 0;
    let rejected = 0;
    let uncontrolled = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const random = createSeededRandom(seedFromLabel(target.id, seed) + iteration * 2654435761);
      const document = target.document === undefined
        ? undefined
        : structuredClone(target.document);
      const applied = [];
      if (document !== undefined) {
        const count = 1 + Math.floor(random() * maximumDocumentMutations);
        for (let at = 0; at < count; at += 1) {
          const { operator } = mutateDocument(document, random, {
            ...(target.documentRoots ? { roots: target.documentRoots } : {}),
          });
          applied.push(operator);
          tally(documentOperatorCounts, operator);
        }
      }
      let binary;
      if (target.binary !== undefined) {
        const mutated = mutateBinary(target.binary, random);
        binary = mutated.bytes;
        applied.push(`binary:${mutated.operator}`);
        tally(binaryOperatorCounts, mutated.operator);
      }
      try {
        target.run({ document, binary });
        accepted += 1;
      } catch (error) {
        const classified = classifyOutcome(error, controlledErrorNames);
        if (classified.outcome === "rejected") {
          rejected += 1;
          tally(rejectionCounts, classified.detail);
        } else {
          uncontrolled += 1;
          tally(uncontrolledCounts, classified.detail);
          if (samples.length < maximumSamples) {
            samples.push({
              target: target.id,
              iteration,
              operators: applied,
              detail: classified.detail,
            });
          }
        }
      }
    }
    recorded.push({
      id: target.id,
      executions: iterations,
      accepted,
      rejected,
      uncontrolled,
      documentOperators: sortedCounts(documentOperatorCounts),
      binaryOperators: sortedCounts(binaryOperatorCounts),
      rejectionsByCode: sortedCounts(rejectionCounts),
      uncontrolledByKind: sortedCounts(uncontrolledCounts),
    });
  }
  return {
    seed,
    iterationsPerTarget: iterations,
    controlledErrorNames: [...controlledErrorNames],
    targets: recorded,
    totals: {
      executions: recorded.reduce((sum, target) => sum + target.executions, 0),
      accepted: recorded.reduce((sum, target) => sum + target.accepted, 0),
      rejected: recorded.reduce((sum, target) => sum + target.rejected, 0),
      uncontrolled: recorded.reduce((sum, target) => sum + target.uncontrolled, 0),
    },
    uncontrolledSamples: samples,
  };
}
