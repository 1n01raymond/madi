// Spawning a native adapter so that cancelling the import actually stops it.
//
// Both adapters are Python processes that run for minutes and spawn work of
// their own. Killing the direct child is not enough: on either platform the
// descendants keep the CPU and the temporary files. So this module owns the
// spawn, and terminates the whole tree - the process group on POSIX, the pid
// tree through `taskkill` on Windows.

import { spawn } from "node:child_process";

/** Rejection raised when an adapter run was stopped by its signal. */
export class AdapterProcessCancelledError extends Error {
  readonly code = "ADAPTER_CANCELLED";

  constructor(label: string) {
    super(`${label} was cancelled.`);
    this.name = "AdapterProcessCancelledError";
  }
}

export function isAdapterProcessCancellation(
  error: unknown,
): error is AdapterProcessCancelledError {
  return error instanceof AdapterProcessCancelledError;
}

export interface AdapterProcessOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  /** How the adapter is named in a failure message, e.g. "OCCT STEP adapter". */
  readonly label: string;
  /** How it is named when it could not be started at all, e.g. "OCCT adapter". */
  readonly startLabel: string;
  /** Recognises a missing Python dependency and replaces the raw stderr. */
  readonly missingModule?: {
    readonly pattern: RegExp;
    readonly message: string;
  };
  readonly signal?: AbortSignal;
  /** Milliseconds between the polite and the forced termination on POSIX. */
  readonly terminationGraceMs?: number;
}

export interface AdapterProcessRun {
  readonly stdout: string;
  /** `Date.now()` immediately before `spawn`, comparable with adapter stamps. */
  readonly spawnedAtMs: number;
  readonly closedAtMs: number;
}

const defaultTerminationGraceMs = 2_000;

/**
 * Terminates a process and everything it started.
 *
 * On POSIX the child leads its own process group, so a negative pid signals the
 * group: SIGTERM first, then SIGKILL once the grace period passes. On Windows
 * there are no process groups to signal, so `taskkill /T /F` walks the pid tree
 * in one step - there is no polite variant to try first.
 */
function terminateProcessTree(pid: number, graceMs: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    // A process that already exited makes taskkill fail; that is the goal, not
    // an error, and nothing else can be done about a failure here anyway.
    killer.once("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  const forced = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, graceMs);
  forced.unref();
}

/**
 * Runs an adapter to completion, or stops it when the signal fires.
 *
 * A cancelled run rejects with `AdapterProcessCancelledError` rather than the
 * adapter's own non-zero exit, because the exit was caused by the termination
 * and reporting it as an adapter failure would be untrue.
 */
export async function runAdapterProcess(
  options: AdapterProcessOptions,
): Promise<AdapterProcessRun> {
  const graceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
  if (options.signal?.aborted === true) {
    throw new AdapterProcessCancelledError(options.label);
  }
  return await new Promise<AdapterProcessRun>((resolvePromise, reject) => {
    const spawnedAtMs = Date.now();
    const child = spawn(options.executable, [...options.arguments], {
      env: options.environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so cancellation can signal the descendants too.
      detached: process.platform !== "win32",
    });

    let cancelled = false;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-16_384);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });

    const onAbort = (): void => {
      cancelled = true;
      const { pid } = child;
      if (pid !== undefined) terminateProcessTree(pid, graceMs);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const detach = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.once("error", (error) => {
      detach();
      if (cancelled) {
        reject(new AdapterProcessCancelledError(options.label));
        return;
      }
      reject(
        new TypeError(
          `Could not start the ${options.startLabel} with ${options.executable}: ${error.message}`,
          { cause: error },
        ),
      );
    });

    child.once("close", (code) => {
      detach();
      if (cancelled) {
        reject(new AdapterProcessCancelledError(options.label));
        return;
      }
      if (code === 0) {
        resolvePromise({ stdout, spawnedAtMs, closedAtMs: Date.now() });
        return;
      }
      const details = stderr.trim() || stdout.trim() || `exit code ${String(code)}`;
      const missing = options.missingModule;
      if (missing !== undefined && missing.pattern.test(details)) {
        reject(new TypeError(missing.message));
        return;
      }
      reject(new TypeError(`${options.label} failed: ${details}.`));
    });
  });
}
