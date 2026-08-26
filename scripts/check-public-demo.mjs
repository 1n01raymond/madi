import { readFile } from "node:fs/promises";

const DEFAULT_URL = "https://1n01raymond.github.io/naru/";
const RANGE_END = 63;

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    url: DEFAULT_URL,
    attempts: 1,
    retryDelayMs: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];

    if (option === "--url" && value) {
      options.url = value;
      index += 1;
    } else if (option === "--attempts" && value) {
      options.attempts = parsePositiveInteger(value, option);
      index += 1;
    } else if (option === "--retry-delay-ms" && value) {
      options.retryDelayMs = parsePositiveInteger(value, option);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${option}`);
    }
  }

  const url = new URL(options.url);
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}`;
  url.search = "";
  url.hash = "";
  options.url = url.href;
  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadResources(reportPath) {
  const report = JSON.parse(await readFile(new URL(reportPath, import.meta.url), "utf8"));
  assert(Array.isArray(report.output?.resources), `${reportPath} has no output resources.`);
  return report.output.resources;
}

async function fetchChecked(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "accept-encoding": "identity",
      "cache-control": "no-cache",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  return response;
}

function cacheBusted(url, attempt) {
  const result = new URL(url);
  result.searchParams.set("naru-smoke", `${Date.now()}-${attempt}`);
  return result;
}

async function checkIndex(baseUrl, attempt) {
  const indexUrl = cacheBusted(baseUrl, attempt);
  const response = await fetchChecked(indexUrl);
  assert(response.status === 200, `${indexUrl.href} returned HTTP ${response.status}.`);
  assert(
    response.headers.get("content-type")?.startsWith("text/html"),
    `${indexUrl.href} did not return HTML.`,
  );

  const html = await response.text();
  assert(html.includes("<title>NARU"), `${indexUrl.href} is not the NARU Studio page.`);

  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((path) => /\/assets\/[^/]+\.(?:css|js)$/u.test(path));
  assert(assetPaths.length > 0, `${indexUrl.href} declares no Vite assets.`);

  for (const assetPath of assetPaths) {
    const assetUrl = cacheBusted(new URL(assetPath, baseUrl), attempt);
    const assetResponse = await fetchChecked(assetUrl, { method: "HEAD" });
    assert(assetResponse.status === 200, `${assetUrl.href} returned HTTP ${assetResponse.status}.`);
  }

  return assetPaths.length;
}

async function checkResource(baseUrl, prefix, resource, attempt) {
  const resourceUrl = cacheBusted(new URL(`${prefix}${resource.path}`, baseUrl), attempt);
  const response = await fetchChecked(resourceUrl, { method: "HEAD" });
  assert(response.status === 200, `${resourceUrl.href} returned HTTP ${response.status}.`);

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  assert(
    contentLength === resource.bytes,
    `${resourceUrl.href} has ${contentLength} bytes; expected ${resource.bytes}.`,
  );
  assert(
    response.headers.get("content-type")?.startsWith(resource.mediaType),
    `${resourceUrl.href} has unexpected content type ${response.headers.get("content-type")}.`,
  );

  if (resource.mediaType !== "application/octet-stream") {
    return false;
  }

  const rangeResponse = await fetchChecked(resourceUrl, {
    headers: { range: `bytes=0-${RANGE_END}` },
  });
  assert(
    rangeResponse.status === 206,
    `${resourceUrl.href} Range request returned HTTP ${rangeResponse.status}.`,
  );
  assert(
    rangeResponse.headers.get("content-range") === `bytes 0-${RANGE_END}/${resource.bytes}`,
    `${resourceUrl.href} returned an unexpected Content-Range.`,
  );
  const range = await rangeResponse.arrayBuffer();
  assert(range.byteLength === RANGE_END + 1, `${resourceUrl.href} returned ${range.byteLength} bytes.`);
  return true;
}

async function checkPackage(baseUrl, prefix, resources, attempt) {
  let rangeCount = 0;
  for (const resource of resources) {
    rangeCount += Number(await checkResource(baseUrl, prefix, resource, attempt));
  }
  return rangeCount;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const digitalHubResources = await loadResources(
    "../artifacts/ifc/digital-hub/build-report.json",
  );
  const pyGamerResources = await loadResources(
    "../artifacts/phase1/adafruit-pygamer/build-report.json",
  );

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const assetCount = await checkIndex(options.url, attempt);
      const digitalHubRanges = await checkPackage(
        options.url,
        "",
        digitalHubResources,
        attempt,
      );
      const pyGamerRanges = await checkPackage(
        options.url,
        "pygamer/",
        pyGamerResources,
        attempt,
      );
      console.log(
        `Public demo smoke check passed: ${assetCount} app assets, ` +
          `${digitalHubResources.length + pyGamerResources.length} package resources, ` +
          `${digitalHubRanges + pyGamerRanges} HTTP Range responses.`,
      );
      return;
    } catch (error) {
      if (attempt === options.attempts) {
        throw error;
      }
      console.warn(`Attempt ${attempt}/${options.attempts} failed: ${error.message}`);
      await wait(options.retryDelayMs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
