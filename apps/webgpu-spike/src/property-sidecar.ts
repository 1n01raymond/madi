import {
  openPropertyValueColumns,
  packagePropertiesSchema,
  parsePackageProperties,
  resolvePropertyEntries,
} from "@naru3d/scene-ir";
import type {
  ColumnPropertyBag,
  PackagePropertiesDocument,
  PropertyValue,
  PropertyValueColumnReader,
} from "@naru3d/scene-ir";
import type { CompiledPropertiesRef } from "@naru3d/runtime-webgpu";

/**
 * Where a scene's `madi.package-properties.1` sidecar can be loaded from. URL
 * scenes resolve both sidecar resources relative to the sidecar JSON; local
 * scenes look the column file up among the extra `.bin` files the user
 * selected next to the glTF.
 */
export type PropertySidecarSource =
  | {
      readonly kind: "url";
      readonly ref: CompiledPropertiesRef;
      readonly jsonUrl: URL;
    }
  | {
      readonly kind: "file";
      readonly ref: CompiledPropertiesRef;
      readonly jsonFile: File;
      readonly resourceFiles: readonly File[];
    };

export interface SemanticPropertyEntries {
  readonly semanticId: string;
  readonly schema?: string;
  readonly entries: readonly (readonly [string, PropertyValue])[];
}

export interface OpenPropertySidecar {
  readonly document: PackagePropertiesDocument;
  readonly reader: PropertyValueColumnReader;
  readonly indexBySemanticId: ReadonlyMap<string, number>;
}

/** Renders one property value for the inspector panel. */
export function formatPropertyValue(value: PropertyValue): string {
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  switch (value.type) {
    case "quantity":
      return `${String(value.value)} ${value.unit}`;
    case "enum":
    case "uri":
      return value.value;
    case "array":
      return value.values.map(formatPropertyValue).join(", ");
  }
}

export function resourceFileName(uri: string): string {
  return decodeURIComponent(new URL(uri, "https://naru.local/").pathname.split("/").pop() ?? "");
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url.href} (${String(response.status)}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Lazily loads a compiled package's property sidecar: nothing is fetched
 * until the first `entriesFor` call, and both resources are validated once
 * (declared byte lengths, `madi.package-properties.1` parse, column header
 * open) and then reused for every later selection.
 */
export class PropertySidecarStore {
  readonly source: PropertySidecarSource;
  private opened?: Promise<OpenPropertySidecar>;

  constructor(source: PropertySidecarSource) {
    this.source = source;
  }

  open(): Promise<OpenPropertySidecar> {
    this.opened ??= this.load();
    return this.opened;
  }

  /**
   * Resolves the panel entries for one semantic, or undefined when the
   * semantic carries no column-backed properties.
   */
  async entriesFor(semanticId: string): Promise<SemanticPropertyEntries | undefined> {
    const { document, reader, indexBySemanticId } = await this.open();
    const index = indexBySemanticId.get(semanticId);
    if (index === undefined) return undefined;
    const schemaIndex = document.semanticSchemas[index] ?? null;
    const schema = schemaIndex === null ? undefined : document.schemas[schemaIndex];
    const bag: ColumnPropertyBag = {
      set: document.semanticSets[index] as number,
      row: document.semanticRows[index] as number,
      ...(schema === undefined ? {} : { schema }),
    };
    const resolved = resolvePropertyEntries(bag, document.propertyIndex, reader);
    const entries = Object.entries(resolved).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return { semanticId, ...(schema === undefined ? {} : { schema }), entries };
  }

  private async load(): Promise<OpenPropertySidecar> {
    const { ref } = this.source;
    if (ref.schemaVersion !== packagePropertiesSchema) {
      throw new TypeError(`Unsupported property sidecar schema ${ref.schemaVersion}.`);
    }
    const jsonBytes = this.source.kind === "url"
      ? await fetchBytes(this.source.jsonUrl)
      : new Uint8Array(await this.source.jsonFile.arrayBuffer());
    if (jsonBytes.byteLength !== ref.byteLength) {
      throw new RangeError(
        `${ref.uri} must be ${String(ref.byteLength)} bytes; ` +
          `received ${String(jsonBytes.byteLength)}.`,
      );
    }
    const document = parsePackageProperties(
      JSON.parse(new TextDecoder().decode(jsonBytes)),
    );
    const columns = this.source.kind === "url"
      ? await fetchBytes(new URL(document.columns.uri, this.source.jsonUrl))
      : await this.readLocalColumns(document.columns.uri);
    if (columns.byteLength !== document.columns.byteLength) {
      throw new RangeError(
        `${document.columns.uri} must be ${String(document.columns.byteLength)} bytes; ` +
          `received ${String(columns.byteLength)}.`,
      );
    }
    const reader = openPropertyValueColumns(document.propertyValues, columns);
    return {
      document,
      reader,
      indexBySemanticId: new Map(document.semanticIds.map((id, index) => [id, index])),
    };
  }

  private async readLocalColumns(uri: string): Promise<Uint8Array> {
    if (this.source.kind !== "file") throw new TypeError("Local columns need file sources.");
    const expectedName = resourceFileName(uri);
    const file = this.source.resourceFiles.find(({ name }) => name === expectedName);
    if (!file) throw new TypeError(`Select ${expectedName} with the glTF file.`);
    return new Uint8Array(await file.arrayBuffer());
  }
}
