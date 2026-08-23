import {
  CompiledGltfError,
  MadiWebGpuError,
  MadiWebGpuRenderer,
} from "@madi/runtime-webgpu";
import type {
  CompiledGltfDocument,
  CompiledHierarchy,
  CompiledBatchEvidence,
  CompiledObjectEvidence,
  CompiledTargetChunk,
  DecodedCompiledScene,
  GeometryRepresentation,
  GpuPrototypeBatch,
} from "@madi/runtime-webgpu";

import type { GeometryDecodeResponse } from "./geometry.worker.js";
import { HierarchySearchIndex } from "./hierarchy-search.js";
import type { HierarchySearchResult } from "./hierarchy-search.js";
import { AxisSectionPlane } from "./section-plane.js";
import type { SectionAxis } from "./section-plane.js";
import {
  loadSceneHierarchy,
  parseSceneUrl,
  selectLocalSceneFiles,
} from "./scene-source.js";
import type { GeometryBinarySource, SceneSource } from "./scene-source.js";
import { OrthographicOrbitCamera } from "./view.js";
import { OccurrenceVisibility } from "./visibility.js";
import faviconUrl from "../../../docs/media/madi-favicon.svg?url";
import inverseMarkUrl from "../../../docs/media/madi-mark-inverse.svg?url";

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`The MADI runtime page is missing ${selector}.`);
  return element;
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} KiB`;
}

function decodeGeometry(
  document: CompiledGltfDocument,
  binary: GeometryBinarySource,
  representation: GeometryRepresentation,
  signal: AbortSignal,
  targetChunkId?: string,
): Promise<{ readonly scene: DecodedCompiledScene; readonly decodeMilliseconds: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), {
      type: "module",
      name: "madi-compiled-geometry",
    });
    const finish = (): void => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = (): void => {
      finish();
      reject(new DOMException("Scene load cancelled.", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener(
      "message",
      (event: MessageEvent<GeometryDecodeResponse>) => {
        finish();
        if (event.data.type === "ready") resolve(event.data);
        else reject(new Error(event.data.message));
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      (event) => {
        finish();
        reject(new Error(event.message || "The geometry Worker failed."));
      },
      { once: true },
    );
    worker.postMessage({
      type: "decode",
      document,
      binary,
      representation,
      ...(targetChunkId ? { targetChunkId } : {}),
    });
  });
}

function binarySourceForChunk(
  source: GeometryBinarySource,
  chunk: CompiledTargetChunk,
): GeometryBinarySource {
  return {
    ...source,
    byteOffset: chunk.byteOffset,
    byteLength: chunk.byteLength,
  };
}

interface ResidentBatch {
  readonly batch: GpuPrototypeBatch;
  readonly evidence: Omit<CompiledBatchEvidence, "batchIndex">;
}

function orderedResidentBatches(
  resident: ReadonlyMap<number, ResidentBatch>,
): readonly [number, ResidentBatch][] {
  return [...resident].sort(([left], [right]) => left - right);
}

function renderHierarchy(hierarchy: CompiledHierarchy): void {
  const list = requireElement<HTMLOListElement>("#hierarchy");
  const fragment = document.createDocumentFragment();
  for (const entry of hierarchy.entries) {
    const item = document.createElement("li");
    item.style.setProperty("--depth", String(entry.depth));
    item.dataset.renderable = String(entry.renderable);
    item.dataset.nodeIndex = String(entry.nodeIndex);
    item.title = entry.occurrenceId;
    if (entry.renderable) {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Select ${entry.name}`);
    }

    const label = document.createElement("span");
    label.textContent = entry.name;
    const kind = document.createElement("small");
    kind.textContent = entry.renderable ? `mesh · node ${entry.nodeIndex}` : "assembly";
    item.append(label, kind);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const status = requireElement<HTMLElement>("#status");
const selection = requireElement<HTMLElement>("#selection");
const hierarchyList = requireElement<HTMLOListElement>("#hierarchy");
const hierarchySearchInput = requireElement<HTMLInputElement>("#hierarchy-search");
const hierarchySearchResult = requireElement<HTMLElement>("#hierarchy-search-result");
const hierarchyEmpty = requireElement<HTMLElement>("#hierarchy-empty");
const propertiesPanel = requireElement<HTMLElement>("#properties-panel");
const propertiesEmpty = requireElement<HTMLElement>("#properties-empty");
const propertiesContent = requireElement<HTMLElement>("#properties-content");
const propertyName = requireElement<HTMLElement>("#property-name");
const propertyVisibility = requireElement<HTMLElement>("#property-visibility");
const propertyOccurrence = requireElement<HTMLElement>("#property-occurrence");
const propertyPrototype = requireElement<HTMLElement>("#property-prototype");
const propertyNode = requireElement<HTMLElement>("#property-node");
const propertyObjectId = requireElement<HTMLElement>("#property-object-id");
const propertySourceRef = requireElement<HTMLElement>("#property-source-ref");
const propertyEdgeCount = requireElement<HTMLElement>("#property-edge-count");
const propertyEdgeRefs = requireElement<HTMLUListElement>("#property-edge-refs");
const visibilityStatus = requireElement<HTMLElement>("#visibility-status");
const hideSelectionButton = requireElement<HTMLButtonElement>("#hide-selection");
const isolateSelectionButton = requireElement<HTMLButtonElement>("#isolate-selection");
const showAllButton = requireElement<HTMLButtonElement>("#show-all");
const toggleSectionButton = requireElement<HTMLButtonElement>("#toggle-section");
const sectionControls = requireElement<HTMLElement>("#section-controls");
const sectionPosition = requireElement<HTMLInputElement>("#section-position");
const sectionPositionValue = requireElement<HTMLOutputElement>("#section-position-value");
const sectionDirection = requireElement<HTMLElement>("#section-direction");
const flipSectionButton = requireElement<HTMLButtonElement>("#flip-section");
const sectionAxisButtons = document.querySelectorAll<HTMLButtonElement>("[data-section-axis]");
const sceneSourceKind = requireElement<HTMLElement>("#scene-source-kind");
const sceneSourceLabel = requireElement<HTMLElement>("#scene-source-label");
const sceneUrlForm = requireElement<HTMLFormElement>("#scene-url-form");
const sceneUrlInput = requireElement<HTMLInputElement>("#scene-url");
const openSceneUrlButton = requireElement<HTMLButtonElement>("#open-scene-url");
const localSceneFiles = requireElement<HTMLInputElement>("#local-scene-files");
const localSceneButton = requireElement<HTMLElement>(".local-scene-button");
const openDemoSceneButton = requireElement<HTMLButtonElement>("#open-demo-scene");
const cancelSceneLoadButton = requireElement<HTMLButtonElement>("#cancel-scene-load");
const defaultSceneUrl = new URL("/scene.gltf", window.location.href);
requireElement<HTMLLinkElement>("#madi-favicon").href = faviconUrl;
requireElement<HTMLImageElement>("#madi-brand-mark").src = inverseMarkUrl;

let disposeActiveScene: (() => void) | undefined;
let cancelPendingSceneLoad: (() => void) | undefined;

function setSourceControlsBusy(busy: boolean): void {
  openSceneUrlButton.disabled = busy;
  sceneUrlInput.disabled = busy;
  localSceneFiles.disabled = busy;
  openDemoSceneButton.disabled = busy;
  cancelSceneLoadButton.hidden = !busy;
  cancelSceneLoadButton.disabled = !busy;
  if (busy) localSceneButton.dataset.disabled = "true";
  else delete localSceneButton.dataset.disabled;
  document.documentElement.dataset.sceneLoading = String(busy);
}

function resetSceneUi(): void {
  delete document.documentElement.dataset.coarseReady;
  delete document.documentElement.dataset.targetReady;
  delete document.documentElement.dataset.geometryRepresentation;
  delete document.documentElement.dataset.targetChunksReady;
  delete document.documentElement.dataset.targetChunksTotal;
  hierarchySearchInput.value = "";
  hierarchySearchResult.textContent = "Waiting for hierarchy";
  hierarchyEmpty.hidden = true;
  hierarchyList.replaceChildren();
  propertiesEmpty.hidden = false;
  propertiesContent.hidden = true;
  selection.textContent = "No occurrence selected.";
  visibilityStatus.textContent = "Waiting for occurrences";
  hideSelectionButton.disabled = true;
  isolateSelectionButton.disabled = true;
  showAllButton.disabled = true;
  toggleSectionButton.setAttribute("aria-pressed", "false");
  sectionControls.hidden = true;
  for (const selector of ["#triangle-count", "#edge-count", "#decode-time", "#gpu-adapter"]) {
    setText(selector, "—");
  }
  for (const selector of ["#stage-hierarchy", "#stage-geometry", "#stage-webgpu"]) {
    const stage = requireElement<HTMLElement>(selector);
    delete stage.dataset.state;
  }
}

async function loadScene(source: SceneSource): Promise<boolean> {
  setSourceControlsBusy(true);
  const cancellation = new AbortController();
  const cancel = (): void => cancellation.abort();
  cancelPendingSceneLoad = cancel;
  let pendingCleanup: (() => void) | undefined;
  try {
    status.textContent = "Loading compiled glTF hierarchy…";
    status.dataset.state = "loading";
    const loaded = await loadSceneHierarchy(source, cancellation.signal);
    const { document: gltf, hierarchy } = loaded;
    disposeActiveScene?.();
    disposeActiveScene = undefined;
    resetSceneUi();
    sceneSourceKind.textContent =
      source.kind === "local"
        ? "LOCAL"
        : source.gltfUrl.href === defaultSceneUrl.href
          ? "DEMO"
          : "URL";
    sceneSourceLabel.textContent = loaded.label;
    sceneSourceLabel.title = loaded.label;
    document.documentElement.dataset.sceneSource = source.kind;
    const interactions = cancellation;
    pendingCleanup = () => interactions.abort();
    const listenerOptions = { signal: interactions.signal };
    renderHierarchy(hierarchy);
    const searchIndex = new HierarchySearchIndex(hierarchy.entries);
    const hierarchyItems = new Map(
      Array.from(hierarchyList.querySelectorAll<HTMLElement>("li[data-node-index]"), (item) => [
        Number(item.dataset.nodeIndex),
        item,
      ]),
    );
    let activeSearch: HierarchySearchResult;
    const applyHierarchySearch = (): void => {
      activeSearch = searchIndex.search(hierarchySearchInput.value);
      const visible = new Set(activeSearch.visibleNodeIndices);
      const matching = new Set(activeSearch.matchingNodeIndices);
      for (const [nodeIndex, item] of hierarchyItems) {
        item.hidden = !visible.has(nodeIndex);
        if (matching.has(nodeIndex)) item.dataset.searchMatch = "true";
        else delete item.dataset.searchMatch;
      }
      const matches = activeSearch.matchingNodeIndices.length;
      hierarchySearchResult.textContent = activeSearch.query
        ? `${matches} ${matches === 1 ? "match" : "matches"}`
        : `${hierarchy.entries.length} nodes`;
      hierarchyEmpty.hidden = visible.size !== 0;
      document.documentElement.dataset.hierarchyMatches = String(matches);
    };
    hierarchySearchInput.addEventListener("input", applyHierarchySearch, listenerOptions);
    applyHierarchySearch();
    setText("#prototype-count", String(hierarchy.sharedMeshes));
    setText("#occurrence-count", String(hierarchy.renderableOccurrences));
    setText("#source-format", hierarchy.sourceFormat);
    setText("#binary-size", formatBytes(hierarchy.binaryByteLength));
    setText("#hierarchy-result", `${hierarchy.entries.length} occurrence records ready`);
    requireElement<HTMLElement>("#stage-hierarchy").dataset.state = "ready";
    document.documentElement.dataset.hierarchyReady = "true";
    status.textContent =
      `Hierarchy ready · ${hierarchy.entries.length} occurrences · ` +
      `decoding ${formatBytes(hierarchy.binaryByteLength)} in Worker…`;
    status.dataset.stage = "hierarchy";

    const renderer = await MadiWebGpuRenderer.create(canvas, {
      onDeviceLost: (message) => {
        status.textContent = `WebGPU device lost: ${message}`;
        status.dataset.state = "error";
      },
    });
    const adapterInfo = renderer.adapter.info;
    setText(
      "#gpu-adapter",
      adapterInfo.description || adapterInfo.vendor || "WebGPU adapter",
    );
    let animationFrame = 0;
    const sessionResources: { resizeObserver?: ResizeObserver } = {};
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      interactions.abort();
      sessionResources.resizeObserver?.disconnect();
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
      renderer.destroy();
    };
    pendingCleanup = dispose;
    disposeActiveScene = dispose;
    const initialRepresentation: GeometryRepresentation = loaded.coarseBinary
      ? "coarse"
      : "target";
    const initial = await decodeGeometry(
      gltf,
      loaded.coarseBinary ?? loaded.targetBinary,
      initialRepresentation,
      interactions.signal,
    ).catch((error: unknown) => {
      dispose();
      throw error;
    });
    let scene = initial.scene;
    let decodeMilliseconds = initial.decodeMilliseconds;
    renderer.setScene(scene.gpuScene);

    const camera = new OrthographicOrbitCamera(scene.bounds);
    const render = (): void => {
      animationFrame = 0;
      const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      renderer.render(camera.viewProjection(aspect));
    };
    const scheduleRender = (): void => {
      if (animationFrame === 0) animationFrame = requestAnimationFrame(render);
    };
    render();

    if (initialRepresentation === "coarse") {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      document.documentElement.dataset.coarseReady = "true";
      document.documentElement.dataset.geometryRepresentation = "coarse";
      status.textContent =
        `Coarse bounds ready · ${scene.summary.partOccurrences} renderable occurrences · ` +
        `loading ${formatBytes(hierarchy.binaryByteLength)} target geometry…`;
      status.dataset.stage = "coarse";
      setText("#triangle-count", scene.summary.triangles.toLocaleString("en-US"));
      setText("#edge-count", scene.summary.edgeSegments.toLocaleString("en-US"));
      setText("#decode-time", `${decodeMilliseconds.toFixed(1)} ms`);
      setText("#geometry-result", `${formatBytes(scene.summary.binaryBytes)} coarse bounds decoded off-thread`);
      requireElement<HTMLElement>("#stage-geometry").dataset.state = "ready";
      requireElement<HTMLElement>("#stage-webgpu").dataset.state = "ready";

      if (hierarchy.targetChunks.length === 0) {
        const target = await decodeGeometry(
          gltf,
          loaded.targetBinary,
          "target",
          interactions.signal,
        ).catch((error: unknown) => {
          dispose();
          throw error;
        });
        scene = target.scene;
        decodeMilliseconds += target.decodeMilliseconds;
        renderer.setScene(scene.gpuScene);
        render();
      } else {
        const resident = new Map<number, ResidentBatch>();
        for (const batchIdentity of scene.batchEvidence) {
          const batch = scene.gpuScene.batches[batchIdentity.batchIndex];
          if (!batch) throw new Error("Coarse batch identity is incomplete.");
          const { batchIndex: _, ...evidence } = batchIdentity;
          resident.set(batchIdentity.targetMeshIndex, { batch, evidence });
        }
        const targetObjects = new Map<number, CompiledObjectEvidence>();
        let targetTriangles = 0;
        let targetEdges = 0;
        let decodedTargetBytes = 0;
        document.documentElement.dataset.targetChunksTotal = String(
          hierarchy.targetChunks.length,
        );

        for (const [chunkIndex, chunk] of hierarchy.targetChunks.entries()) {
          const target = await decodeGeometry(
            gltf,
            binarySourceForChunk(loaded.targetBinary, chunk),
            "target",
            interactions.signal,
            chunk.id,
          ).catch((error: unknown) => {
            dispose();
            throw error;
          });
          decodeMilliseconds += target.decodeMilliseconds;
          decodedTargetBytes += target.scene.summary.binaryBytes;
          targetTriangles += target.scene.summary.triangles;
          targetEdges += target.scene.summary.edgeSegments;
          for (const entry of target.scene.objectEvidence) {
            targetObjects.set(entry.objectId, entry);
          }
          for (const batchIdentity of target.scene.batchEvidence) {
            const batch = target.scene.gpuScene.batches[batchIdentity.batchIndex];
            if (!batch) throw new Error(`Target chunk ${chunk.id} has incomplete batch identity.`);
            const { batchIndex: _, ...evidence } = batchIdentity;
            resident.set(batchIdentity.targetMeshIndex, { batch, evidence });
          }
          const ordered = orderedResidentBatches(resident);
          renderer.setScene({ batches: ordered.map(([, entry]) => entry.batch) });
          render();
          const residentTriangles = ordered.reduce(
            (total, [, entry]) => total + entry.batch.surfaceIndices.length / 3,
            0,
          );
          const residentEdges = ordered.reduce(
            (total, [, entry]) => total + entry.batch.edgeVertices.length / 6,
            0,
          );
          const readyChunks = chunkIndex + 1;
          document.documentElement.dataset.targetChunksReady = String(readyChunks);
          document.documentElement.dataset.geometryRepresentation =
            readyChunks === hierarchy.targetChunks.length ? "target" : "mixed";
          status.textContent =
            `Target detail ${readyChunks}/${hierarchy.targetChunks.length} · ` +
            `${targetObjects.size} occurrences promoted · ` +
            `${formatBytes(decodedTargetBytes)} range-decoded`;
          status.dataset.stage = "target-chunks";
          setText("#triangle-count", residentTriangles.toLocaleString("en-US"));
          setText("#edge-count", residentEdges.toLocaleString("en-US"));
          setText("#decode-time", `${decodeMilliseconds.toFixed(1)} ms`);
          setText(
            "#geometry-result",
            `${formatBytes(decodedTargetBytes)} target ranges decoded off-thread`,
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }

        const ordered = orderedResidentBatches(resident);
        scene = {
          gpuScene: { batches: ordered.map(([, entry]) => entry.batch) },
          bounds: scene.bounds,
          hierarchy,
          objectEvidence: [...targetObjects.values()].sort(
            (left, right) => left.nodeIndex - right.nodeIndex,
          ),
          batchEvidence: ordered.map(([, entry], batchIndex) => ({
            ...entry.evidence,
            batchIndex,
          })),
          summary: {
            prototypeBatches: ordered.length,
            partOccurrences: targetObjects.size,
            triangles: targetTriangles,
            edgeSegments: targetEdges,
            binaryBytes: hierarchy.binaryByteLength,
            representation: "target",
          },
        };
      }
    }

    document.documentElement.dataset.geometryRepresentation = "target";
    document.documentElement.dataset.targetReady = "true";

    status.textContent =
      `Compiled glTF ready · ${scene.summary.prototypeBatches} shared meshes · ` +
      `${scene.summary.partOccurrences} renderable occurrences`;
    status.dataset.state = "ready";
    status.dataset.stage = "rendered";
    setText("#triangle-count", scene.summary.triangles.toLocaleString("en-US"));
    setText("#edge-count", scene.summary.edgeSegments.toLocaleString("en-US"));
    setText("#decode-time", `${decodeMilliseconds.toFixed(1)} ms`);
    setText("#geometry-result", `${formatBytes(scene.summary.binaryBytes)} decoded off-thread`);
    requireElement<HTMLElement>("#stage-geometry").dataset.state = "ready";
    requireElement<HTMLElement>("#stage-webgpu").dataset.state = "ready";
    const evidence = new Map(scene.objectEvidence.map((entry) => [entry.objectId, entry]));
    const evidenceByNode = new Map(scene.objectEvidence.map((entry) => [entry.nodeIndex, entry]));
    const visibility = new OccurrenceVisibility(scene.gpuScene);
    const section = new AxisSectionPlane(scene.bounds);
    let selectedObjectId = 0;

    const updateProperties = (picked: CompiledObjectEvidence | undefined): void => {
      propertiesEmpty.hidden = Boolean(picked);
      propertiesContent.hidden = !picked;
      propertiesPanel.dataset.state = picked ? "selected" : "empty";
      document.documentElement.dataset.selectedObjectId = String(picked?.objectId ?? 0);
      if (!picked) return;

      const isVisible = visibility.isVisible(picked.objectId);
      propertyName.textContent = picked.label;
      propertyVisibility.textContent = isVisible ? "Visible" : "Hidden";
      if (isVisible) delete propertyVisibility.dataset.hidden;
      else propertyVisibility.dataset.hidden = "true";
      propertyOccurrence.textContent = picked.occurrenceId;
      propertyPrototype.textContent = picked.prototypeId;
      propertyNode.textContent = String(picked.nodeIndex);
      propertyObjectId.textContent = String(picked.objectId);
      propertySourceRef.textContent = picked.sourceRef ?? "Not provided";
      propertyEdgeCount.textContent = picked.edgeSourceRefs.length.toLocaleString("en-US");

      const fragment = document.createDocumentFragment();
      for (const sourceRef of picked.edgeSourceRefs.slice(0, 3)) {
        const item = document.createElement("li");
        item.textContent = sourceRef;
        item.title = sourceRef;
        fragment.append(item);
      }
      if (picked.edgeSourceRefs.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No edge references in the compiled profile.";
        fragment.append(item);
      } else if (picked.edgeSourceRefs.length > 3) {
        const item = document.createElement("li");
        item.dataset.summary = "true";
        item.textContent = `+ ${picked.edgeSourceRefs.length - 3} more`;
        fragment.append(item);
      }
      propertyEdgeRefs.replaceChildren(fragment);
    };

    const updateSelectionText = (): void => {
      const picked = evidence.get(selectedObjectId);
      selection.textContent = picked
        ? `Selected ${picked.label} · node ${picked.nodeIndex} · ID ${selectedObjectId} · ` +
          `${picked.edgeSourceRefs.length} CAD edge refs` +
          (visibility.isVisible(selectedObjectId) ? "" : " · hidden")
        : "No occurrence at that pixel.";
      updateProperties(picked);
    };

    const updateVisibilityControls = (): void => {
      const state = visibility.state();
      visibilityStatus.textContent =
        state.mode === "all"
          ? `${state.visibleOccurrences} / ${state.totalOccurrences} visible`
          : state.mode === "isolated"
            ? `${state.visibleOccurrences} / ${state.totalOccurrences} visible · isolated`
            : `${state.visibleOccurrences} / ${state.totalOccurrences} visible · ` +
              `${state.hiddenOccurrences} hidden`;
      hideSelectionButton.disabled =
        selectedObjectId === 0 || !visibility.isVisible(selectedObjectId);
      isolateSelectionButton.disabled =
        selectedObjectId === 0 || state.isolatedObjectId === selectedObjectId;
      showAllButton.disabled = state.mode === "all";
      document.documentElement.dataset.visibilityMode = state.mode;
      document.documentElement.dataset.visibleOccurrences = String(state.visibleOccurrences);
    };

    const applyVisibility = (): void => {
      renderer.updateVisibleInstances(visibility.indicesByBatch, visibility.counts);
      for (const entry of scene.objectEvidence) {
        const item = hierarchyList.querySelector<HTMLElement>(
          `[data-node-index="${entry.nodeIndex}"]`,
        );
        if (!item) continue;
        if (visibility.isVisible(entry.objectId)) delete item.dataset.hidden;
        else item.dataset.hidden = "true";
      }
      updateSelectionText();
      updateVisibilityControls();
      scheduleRender();
    };

    const selectObject = (objectId: number): void => {
      const picked = evidence.get(objectId);
      selectedObjectId = picked ? objectId : 0;
      renderer.setSelection(selectedObjectId);
      for (const item of hierarchyList.querySelectorAll<HTMLElement>("[data-selected='true']")) {
        delete item.dataset.selected;
        item.removeAttribute("aria-current");
      }
      if (picked) {
        const item = hierarchyList.querySelector<HTMLElement>(
          `[data-node-index="${picked.nodeIndex}"]`,
        );
        if (item) {
          if (item.hidden) {
            hierarchySearchInput.value = "";
            applyHierarchySearch();
          }
          item.dataset.selected = "true";
          item.setAttribute("aria-current", "true");
          const itemBounds = item.getBoundingClientRect();
          const listBounds = hierarchyList.getBoundingClientRect();
          if (itemBounds.top < listBounds.top) {
            hierarchyList.scrollTop -= listBounds.top - itemBounds.top;
          } else if (itemBounds.bottom > listBounds.bottom) {
            hierarchyList.scrollTop += itemBounds.bottom - listBounds.bottom;
          }
        }
      }
      updateSelectionText();
      updateVisibilityControls();
      scheduleRender();
    };

    const hideSelection = (): void => {
      if (selectedObjectId === 0) return;
      visibility.hide(selectedObjectId);
      applyVisibility();
    };
    const isolateSelection = (): void => {
      if (selectedObjectId === 0) return;
      visibility.isolate(selectedObjectId);
      applyVisibility();
    };
    const showAll = (): void => {
      visibility.showAll();
      applyVisibility();
    };
    updateVisibilityControls();
    updateProperties(undefined);

    const applySection = (): void => {
      const state = section.state();
      renderer.setSectionPlane(section.plane());
      toggleSectionButton.setAttribute("aria-pressed", String(state.enabled));
      sectionControls.hidden = !state.enabled;
      sectionPosition.value = String(Math.round(state.fraction * 100));
      sectionPositionValue.textContent =
        `${state.axis.toUpperCase()} · ${Math.round(state.fraction * 100)}%`;
      sectionDirection.textContent =
        `Keep ${state.direction === 1 ? "−" : "+"}${state.axis.toUpperCase()} side`;
      for (const button of sectionAxisButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.sectionAxis === state.axis));
      }
      document.documentElement.dataset.sectionEnabled = String(state.enabled);
      document.documentElement.dataset.sectionAxis = state.axis;
      scheduleRender();
    };

    const toggleSection = (): void => {
      section.toggle();
      applySection();
    };
    applySection();

    let activePointer: number | undefined;
    let navigationMode: "orbit" | "pan" = "orbit";
    let lastPointerX = 0;
    let lastPointerY = 0;
    let pointerTravel = 0;
    let suppressClick = false;

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        activePointer = event.pointerId;
        navigationMode = event.button === 1 || event.shiftKey ? "pan" : "orbit";
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        pointerTravel = 0;
        suppressClick = false;
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("is-navigating");
        event.preventDefault();
      },
      listenerOptions,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId !== activePointer) return;
        const deltaX = event.clientX - lastPointerX;
        const deltaY = event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        pointerTravel += Math.abs(deltaX) + Math.abs(deltaY);
        if (pointerTravel < 2) return;
        const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
        if (navigationMode === "pan") {
          camera.pan(deltaX, deltaY, canvas.clientWidth, canvas.clientHeight, aspect);
        } else {
          camera.orbit(deltaX, deltaY);
        }
        scheduleRender();
      },
      listenerOptions,
    );
    const finishNavigation = (event: PointerEvent): void => {
      if (event.pointerId !== activePointer) return;
      suppressClick = pointerTravel >= 3;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      activePointer = undefined;
      canvas.classList.remove("is-navigating");
    };
    canvas.addEventListener("pointerup", finishNavigation, listenerOptions);
    canvas.addEventListener("pointercancel", finishNavigation, listenerOptions);
    canvas.addEventListener(
      "wheel",
      (event) => {
        camera.zoomBy(event.deltaY);
        scheduleRender();
        event.preventDefault();
      },
      { ...listenerOptions, passive: false },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), listenerOptions);

    const fitView = (): void => {
      camera.fit();
      scheduleRender();
    };
    requireElement<HTMLButtonElement>("#fit-view").addEventListener("click", fitView, listenerOptions);
    hideSelectionButton.addEventListener("click", hideSelection, listenerOptions);
    isolateSelectionButton.addEventListener("click", isolateSelection, listenerOptions);
    showAllButton.addEventListener("click", showAll, listenerOptions);
    toggleSectionButton.addEventListener("click", toggleSection, listenerOptions);
    flipSectionButton.addEventListener(
      "click",
      () => {
        section.flip();
        applySection();
      },
      listenerOptions,
    );
    sectionPosition.addEventListener(
      "input",
      () => {
        section.setFraction(Number(sectionPosition.value) / 100);
        applySection();
      },
      listenerOptions,
    );
    for (const button of sectionAxisButtons) {
      button.addEventListener(
        "click",
        () => {
          section.setAxis(button.dataset.sectionAxis as SectionAxis);
          applySection();
        },
        listenerOptions,
      );
    }
    hierarchySearchInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && hierarchySearchInput.value !== "") {
          hierarchySearchInput.value = "";
          applyHierarchySearch();
          event.preventDefault();
          return;
        }
        if (event.key !== "Enter" || activeSearch.firstRenderableNodeIndex === undefined) return;
        const picked = evidenceByNode.get(activeSearch.firstRenderableNodeIndex);
        if (picked) selectObject(picked.objectId);
        event.preventDefault();
      },
      listenerOptions,
    );
    window.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        if (
          event.key === "/" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement)
        ) {
          hierarchySearchInput.focus();
          hierarchySearchInput.select();
          event.preventDefault();
          return;
        }
        if (
          event.ctrlKey ||
          event.metaKey ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "f") fitView();
        else if (key === "c") toggleSection();
        else if (key === "h" && event.shiftKey) showAll();
        else if (key === "h") hideSelection();
        else if (key === "i") isolateSelection();
        else if (key === "escape" && visibility.state().mode !== "all") showAll();
        else return;
        event.preventDefault();
      },
      listenerOptions,
    );

    const selectHierarchyTarget = (target: EventTarget | null): boolean => {
      const item = target instanceof Element ? target.closest<HTMLElement>("li[data-node-index]") : null;
      if (!item || item.dataset.renderable !== "true") return false;
      const nodeIndex = Number(item.dataset.nodeIndex);
      const picked = evidenceByNode.get(nodeIndex);
      if (!picked) return false;
      selectObject(picked.objectId);
      return true;
    };
    hierarchyList.addEventListener(
      "click",
      (event) => {
        selectHierarchyTarget(event.target);
      },
      listenerOptions,
    );
    hierarchyList.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (selectHierarchyTarget(event.target)) event.preventDefault();
      },
      listenerOptions,
    );

    sessionResources.resizeObserver = new ResizeObserver(scheduleRender);
    sessionResources.resizeObserver.observe(canvas);

    canvas.addEventListener("click", async (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const objectId = await renderer.pick(event.clientX, event.clientY);
      selectObject(objectId);
    }, listenerOptions);

    pendingCleanup = undefined;
    return true;
  } catch (error) {
    const cleanup = pendingCleanup;
    cleanup?.();
    if (disposeActiveScene === cleanup) disposeActiveScene = undefined;
    const message =
      error instanceof CompiledGltfError ||
      error instanceof MadiWebGpuError ||
      error instanceof Error
        ? error.message
        : String(error);
    status.textContent = message;
    status.dataset.state = "error";
    return false;
  } finally {
    if (cancelPendingSceneLoad === cancel) cancelPendingSceneLoad = undefined;
    setSourceControlsBusy(false);
  }
}

function replaceSceneQuery(sceneUrl?: URL): void {
  const pageUrl = new URL(window.location.href);
  if (sceneUrl) pageUrl.searchParams.set("scene", sceneUrl.href);
  else pageUrl.searchParams.delete("scene");
  window.history.replaceState(null, "", pageUrl);
}

sceneUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let gltfUrl: URL;
  try {
    gltfUrl = parseSceneUrl(sceneUrlInput.value, window.location.href);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = "error";
    return;
  }
  void loadScene({ kind: "url", gltfUrl }).then((loaded) => {
    if (loaded) replaceSceneQuery(gltfUrl);
  });
});

localSceneFiles.addEventListener("change", () => {
  let source: SceneSource;
  try {
    source = selectLocalSceneFiles(Array.from(localSceneFiles.files ?? []));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = "error";
    localSceneFiles.value = "";
    return;
  }
  void loadScene(source).then((loaded) => {
    localSceneFiles.value = "";
    if (loaded) replaceSceneQuery();
  });
});

openDemoSceneButton.addEventListener("click", () => {
  sceneUrlInput.value = defaultSceneUrl.href;
  void loadScene({ kind: "url", gltfUrl: defaultSceneUrl }).then((loaded) => {
    if (loaded) replaceSceneQuery();
  });
});

cancelSceneLoadButton.addEventListener("click", () => {
  cancelPendingSceneLoad?.();
});

window.addEventListener(
  "beforeunload",
  () => {
    cancelPendingSceneLoad?.();
    disposeActiveScene?.();
  },
  { once: true },
);

const requestedScene = new URL(window.location.href).searchParams.get("scene");
let initialSceneUrl = defaultSceneUrl;
if (requestedScene) {
  try {
    initialSceneUrl = parseSceneUrl(requestedScene, window.location.href);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = "error";
  }
}
sceneUrlInput.value = initialSceneUrl.href;
await loadScene({ kind: "url", gltfUrl: initialSceneUrl });
