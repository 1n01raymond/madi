import type { CompiledHierarchyEntry } from "@naru3d/runtime-webgpu";

/** The contiguous row slice a scrollport covers, plus the rows spaced around it. */
export interface HierarchyRowWindow {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly leadingRows: number;
  readonly trailingRows: number;
}

/**
 * Chooses the rows a scrollport needs. Rows are uniform height, so the window is
 * one slice and the rest of the list is two spacers. Kept free of DOM access so
 * the arithmetic that decides how many elements exist at all is unit-testable.
 */
export function hierarchyRowWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscanRows: number,
): HierarchyRowWindow {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, leadingRows: 0, trailingRows: 0 };
  }
  const firstVisible = Math.floor(Math.max(scrollTop, 0) / rowHeight);
  const scrollportRows = Math.ceil(Math.max(viewportHeight, 0) / rowHeight) + 1;
  const start = Math.min(Math.max(firstVisible - overscanRows, 0), rowCount - 1);
  const end = Math.min(rowCount, start + scrollportRows + overscanRows * 2);
  return { start, end, leadingRows: start, trailingRows: rowCount - end };
}

const DEFAULT_OVERSCAN_ROWS = 6;
/** Used until a real row can be measured; replaced on the first render. */
const FALLBACK_ROW_HEIGHT = 27;

export interface HierarchyListViewOptions {
  readonly signal: AbortSignal;
  readonly overscanRows?: number;
}

/**
 * Renders the assembly tree through a fixed-size element pool.
 *
 * A federation the size of the sixty5 fixture has 188,319 rows; materializing
 * them all costs half a million elements, and every host whose accessibility
 * mode is on then pays to walk that tree before the first frame can be painted.
 * Only the rows a scrollport covers exist here, so that cost is bounded by the
 * panel height instead of by the model size.
 */
export class HierarchyListView {
  private readonly list: HTMLOListElement;
  private readonly entriesByNodeIndex = new Map<number, CompiledHierarchyEntry>();
  private readonly overscanRows: number;
  private readonly leadingSpacer = createSpacer();
  private readonly trailingSpacer = createSpacer();
  private readonly pool: HTMLLIElement[] = [];
  private rows: readonly number[] = [];
  private rowPositions = new Map<number, number>();
  private matching: ReadonlySet<number> = new Set();
  private hiddenNodeIndices: ReadonlySet<number> = new Set();
  private selectedNodeIndex?: number;
  /** Row position that owns DOM focus, tracked across pool recycling. */
  private focusedPosition?: number;
  private rowHeight = FALLBACK_ROW_HEIGHT;
  private renderedStart = 0;
  private renderScheduled = false;

  constructor(
    list: HTMLOListElement,
    entries: readonly CompiledHierarchyEntry[],
    options: HierarchyListViewOptions,
  ) {
    this.list = list;
    this.overscanRows = options.overscanRows ?? DEFAULT_OVERSCAN_ROWS;
    for (const entry of entries) this.entriesByNodeIndex.set(entry.nodeIndex, entry);
    list.replaceChildren(this.leadingSpacer, this.trailingSpacer);

    const listenerOptions = { signal: options.signal };
    list.addEventListener("scroll", () => this.scheduleRender(), {
      ...listenerOptions,
      passive: true,
    });
    list.addEventListener("keydown", (event) => this.navigate(event), listenerOptions);
    list.addEventListener("focusin", (event) => this.adoptFocusedRow(event), listenerOptions);
    const observer = new ResizeObserver(() => this.scheduleRender());
    observer.observe(list);
    options.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  /** Rows currently displayed, in order, after the search filter. */
  get rowCount(): number {
    return this.rows.length;
  }

  hasRow(nodeIndex: number): boolean {
    return this.rowPositions.has(nodeIndex);
  }

  setFilter(visibleNodeIndices: readonly number[], matching: ReadonlySet<number>): void {
    // Positions mean something else once the list is filtered.
    this.focusedPosition = undefined;
    this.rows = visibleNodeIndices;
    this.rowPositions = new Map(visibleNodeIndices.map((nodeIndex, at) => [nodeIndex, at]));
    this.matching = matching;
    this.render();
  }

  setHiddenNodeIndices(hiddenNodeIndices: ReadonlySet<number>): void {
    this.hiddenNodeIndices = hiddenNodeIndices;
    this.render();
  }

  setSelected(nodeIndex?: number): void {
    this.selectedNodeIndex = nodeIndex;
    this.render();
  }

  /** Scrolls a row into the scrollport, materializing it if it was outside. */
  reveal(nodeIndex: number): void {
    const position = this.rowPositions.get(nodeIndex);
    if (position === undefined) return;
    this.scrollRowIntoView(position);
    this.render();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private scrollRowIntoView(position: number): void {
    const top = position * this.rowHeight;
    const bottom = top + this.rowHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) {
      this.list.scrollTop = bottom - this.list.clientHeight;
    }
  }

  /** Records the row a click or Tab focused, so arrow keys continue from it. */
  private adoptFocusedRow(event: FocusEvent): void {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>("li[data-node-index]")
      : null;
    if (!item) return;
    this.focusedPosition = this.rowPositions.get(Number(item.dataset.nodeIndex));
  }

  /**
   * Arrow keys walk the whole list, not just the materialized window, so a
   * keyboard or screen-reader user still reaches every row.
   */
  private navigate(event: KeyboardEvent): void {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const last = this.rows.length - 1;
    if (last < 0) return;
    const focused = event.target instanceof Element
      ? event.target.closest<HTMLElement>("li[data-node-index]")
      : null;
    // Prefer the tracked position: the focused element is recycled while the
    // window moves, so its current row is not where navigation left off.
    const current = this.focusedPosition
      ?? (focused ? this.rowPositions.get(Number(focused.dataset.nodeIndex)) : undefined);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : current === undefined
          ? 0
          : Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), last);
    event.preventDefault();
    this.focusedPosition = next;
    this.scrollRowIntoView(next);
    this.render();
  }

  private render(): void {
    const rowWindow = hierarchyRowWindow(
      this.rows.length,
      this.list.scrollTop,
      this.list.clientHeight,
      this.rowHeight,
      this.overscanRows,
    );
    const poolSize = rowWindow.end - rowWindow.start;
    while (this.pool.length > poolSize) this.pool.pop()?.remove();
    while (this.pool.length < poolSize) {
      const item = createRow();
      this.pool.push(item);
      this.list.insertBefore(item, this.trailingSpacer);
    }
    this.renderedStart = rowWindow.start;
    for (const [slot, item] of this.pool.entries()) this.updateRow(item, rowWindow.start + slot);
    this.leadingSpacer.style.height = `${rowWindow.leadingRows * this.rowHeight}px`;
    this.trailingSpacer.style.height = `${rowWindow.trailingRows * this.rowHeight}px`;
    this.restoreFocus(rowWindow);
    this.adoptMeasuredRowHeight();
  }

  /**
   * Focus follows the row position, not the element: the pool is recycled in
   * place, so a focused element would otherwise start presenting a different
   * row. Focusing never scrolls, because the window above owns the offset --
   * letting the browser scroll here moved the list under the keyboard.
   */
  private restoreFocus(rowWindow: HierarchyRowWindow): void {
    if (this.focusedPosition === undefined) return;
    if (!this.list.contains(document.activeElement)) return;
    const item = this.pool[this.focusedPosition - rowWindow.start];
    if (!item) {
      // The row was scrolled out from under the caret; the visible row wins.
      this.focusedPosition = undefined;
      return;
    }
    if (item !== document.activeElement) item.focus({ preventScroll: true });
  }

  /**
   * The stylesheet owns the row height, so it is measured once from a real row
   * rather than duplicated here; a corrected height re-runs the layout above.
   */
  private adoptMeasuredRowHeight(): void {
    const measured = this.pool[0]?.offsetHeight ?? 0;
    if (measured <= 0 || measured === this.rowHeight) return;
    this.rowHeight = measured;
    this.render();
  }

  private updateRow(item: HTMLLIElement, position: number): void {
    const nodeIndex = this.rows[position];
    const entry = nodeIndex === undefined ? undefined : this.entriesByNodeIndex.get(nodeIndex);
    if (!entry) return;
    item.style.setProperty("--depth", String(entry.depth));
    item.dataset.renderable = String(entry.renderable);
    item.dataset.nodeIndex = String(entry.nodeIndex);
    item.title = entry.occurrenceId;
    if (entry.renderable) {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Select ${entry.name}`);
    } else {
      item.tabIndex = -1;
      item.removeAttribute("role");
      item.removeAttribute("aria-label");
    }
    setFlag(item, "searchMatch", this.matching.has(entry.nodeIndex));
    setFlag(item, "hidden", this.hiddenNodeIndices.has(entry.nodeIndex));
    if (this.selectedNodeIndex === entry.nodeIndex) {
      item.dataset.selected = "true";
      item.setAttribute("aria-current", "true");
    } else {
      delete item.dataset.selected;
      item.removeAttribute("aria-current");
    }
    const [label, kind] = item.children;
    if (label) label.textContent = entry.name;
    if (kind) {
      kind.textContent = entry.renderable ? `mesh · node ${entry.nodeIndex}` : "assembly";
    }
  }
}

function setFlag(item: HTMLLIElement, key: "searchMatch" | "hidden", on: boolean): void {
  if (on) item.dataset[key] = "true";
  else delete item.dataset[key];
}

function createSpacer(): HTMLLIElement {
  const spacer = document.createElement("li");
  spacer.className = "hierarchy-spacer";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function createRow(): HTMLLIElement {
  const item = document.createElement("li");
  item.append(document.createElement("span"), document.createElement("small"));
  return item;
}
