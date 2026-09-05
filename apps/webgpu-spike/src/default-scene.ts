import { assertPackageUrl } from "@naru3d/runtime-webgpu";

/**
 * Build variable naming the package the Studio opens when the page asks for
 * no scene. Quoted in every refusal below so a deployment defect names the
 * setting to fix.
 */
export const defaultScenePackageUrlVariable = "VITE_NARU_DEFAULT_SCENE_URL";

/** Build-time inputs that decide where the Studio's default scene lives. */
export interface DefaultSceneEnvironment {
  /** Vite's `BASE_URL`: the site path the application was built for. */
  readonly baseUrl: string;
  /**
   * The configured delivery origin's document URL, as read from
   * `import.meta.env`. Typed `unknown` because that value is `any`, and a
   * misconfigured build must be refused rather than coerced.
   */
  readonly configuredPackageUrl?: unknown;
}

function refuse(reason: string, received: string): never {
  throw new TypeError(
    `${defaultScenePackageUrlVariable} ${reason}; received ${JSON.stringify(received)}.`,
  );
}

/**
 * Decides which compiled glTF document the Studio opens by default.
 *
 * Unset, empty, or blank means "not configured": an unset repository variable
 * reaches a workflow as an empty string, so treating blanks as configuration
 * would turn a missing setting into a broken build. Those cases keep the
 * site-relative document the demo has always used.
 *
 * A configured value is held to what the loader can actually open. It must be
 * absolute, because a relative value would resolve against the page and point
 * back at the site the package was moved out of -- the exact failure this
 * setting exists to prevent. It must name the glTF document rather than its
 * directory, because every declared resource resolves relative to the document
 * URL, so a directory URL silently looks for resources one level up. And it
 * carries no query or fragment, since neither survives that relative
 * resolution and their presence means the URL was copied from somewhere it
 * does not belong.
 *
 * A value that fails any of these is a build defect. It is refused here rather
 * than replaced by the site-relative default, which would leave a deployment
 * quietly serving a different scene than the one it was configured for.
 */
export function resolveDefaultSceneUrl(
  environment: DefaultSceneEnvironment,
  pageHref: string,
): URL {
  const configured = environment.configuredPackageUrl;
  if (configured === undefined || configured === null) {
    return new URL(`${environment.baseUrl}scene.gltf`, pageHref);
  }
  if (typeof configured !== "string") {
    throw new TypeError(`${defaultScenePackageUrlVariable} must be a string.`);
  }

  const trimmed = configured.trim();
  if (trimmed === "") {
    return new URL(`${environment.baseUrl}scene.gltf`, pageHref);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    refuse("must be an absolute URL", trimmed);
  }
  assertPackageUrl(url, defaultScenePackageUrlVariable);
  if (url.search !== "" || url.hash !== "") {
    refuse("must not carry a query or fragment", trimmed);
  }
  if (!url.pathname.endsWith(".gltf")) {
    refuse("must name a compiled glTF document, not its directory", trimmed);
  }
  return url;
}
