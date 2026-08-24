import { spawnSync } from "node:child_process";

// Runs the IFC federation adapter's pure-math unit tests
// (`native/adapter-ifc/tests/`). Deliberately independent of the pinned
// IfcOpenShell environment: `native/adapter-ifc/tools/placement_math.py`
// has no adapter import, so only `requirements-dev.txt` is needed and CI can
// run this without the heavier `requirements-evidence.txt` install.
//
// Usage: node scripts/run-adapter-ifc-tests.mjs [--python <path>] [--allow-missing]

const arguments_ = process.argv.slice(2);
const allowMissing = arguments_.includes("--allow-missing");
const pythonFlagIndex = arguments_.indexOf("--python");
const explicitPython = pythonFlagIndex === -1 ? undefined : arguments_[pythonFlagIndex + 1];

const candidates = [
  explicitPython,
  process.env.MADI_PYTHON,
  process.platform === "win32" ? "python" : "python3",
].filter((candidate) => Boolean(candidate));

function probe(pythonCommand) {
  const result = spawnSync(pythonCommand, ["-c", "import pytest, numpy"], {
    encoding: "utf8",
  });
  return result.error === undefined && result.status === 0;
}

const pythonCommand = candidates.find((candidate) => probe(candidate));

if (!pythonCommand) {
  const message =
    "[adapter:ifc:test] no Python interpreter with pytest + numpy found " +
    `(tried: ${candidates.length > 0 ? candidates.join(", ") : "(none)"}). ` +
    "Install native/adapter-ifc/tools/requirements-dev.txt, or pass " +
    "--python <path> / set MADI_PYTHON.";
  if (allowMissing) {
    console.warn(`${message} Skipping (--allow-missing).`);
    process.exit(0);
  }
  console.error(message);
  process.exitCode = 1;
} else {
  console.log(`[adapter:ifc:test] using ${pythonCommand}`);
  const result = spawnSync(pythonCommand, ["-m", "pytest", "native/adapter-ifc/tests", "-q"], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}
