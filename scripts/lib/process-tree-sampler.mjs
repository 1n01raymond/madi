/**
 * Samples the working set of a launched process tree on Windows.
 *
 * A compile spends most of its bytes in a native adapter this process only
 * spawns, so `process.memoryUsage()` inside the compiler measures the wrong
 * thing. `Win32_Process` is the one interface that reports every descendant,
 * so one long-lived PowerShell session emits a snapshot of the whole table on
 * a fixed interval and the tree is walked from the launched pid here.
 *
 * The peak this produces is a sampled maximum: an allocation that rises and
 * falls entirely between two snapshots is invisible to it. The per-process
 * `PeakWorkingSetSize` counter the operating system maintains is reported
 * beside it, summed over the tree, as an upper bound that no sampling gap can
 * miss but that charges peaks which never coincided.
 */
import { spawn } from "node:child_process";

export const processTreeSampleMethod = "os-sampled-win32-process-tree";

const snapshotDelimiter = "<<snapshot>>";

function snapshotScript(intervalMilliseconds) {
  return (
    "while ($true) { " +
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,PeakWorkingSetSize | " +
    "ConvertTo-Json -Compress; " +
    `Write-Output '${snapshotDelimiter}'; ` +
    `Start-Sleep -Milliseconds ${intervalMilliseconds} }`
  );
}

function walkTree(rows, rootPid) {
  const childrenByParent = new Map();
  const byPid = new Map();
  for (const row of rows) {
    byPid.set(row.ProcessId, row);
    const siblings = childrenByParent.get(row.ParentProcessId);
    if (siblings) siblings.push(row);
    else childrenByParent.set(row.ParentProcessId, [row]);
  }
  const root = byPid.get(rootPid);
  if (!root) return [];
  const tree = [root];
  const queue = [rootPid];
  const visited = new Set();
  while (queue.length > 0) {
    const pid = queue.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    for (const child of childrenByParent.get(pid) ?? []) {
      tree.push(child);
      queue.push(child.ProcessId);
    }
  }
  return tree;
}

/**
 * Starts one sampler for the lifetime of a recording session. Callers open a
 * window per run so a sample belongs to exactly one measured compile.
 */
export function startProcessTreeSampler({ intervalMilliseconds = 500 } = {}) {
  if (process.platform !== "win32") {
    throw new TypeError("The process-tree sampler is implemented for Windows only.");
  }
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", snapshotScript(intervalMilliseconds)],
    { windowsHide: true },
  );
  const windows = new Set();
  let buffer = "";
  let snapshots = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let at = buffer.indexOf(snapshotDelimiter);
    while (at !== -1) {
      const text = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + snapshotDelimiter.length);
      at = buffer.indexOf(snapshotDelimiter);
      if (!text) continue;
      let rows;
      try {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        continue;
      }
      snapshots += 1;
      for (const observation of windows) observation.accept(rows);
    }
  });
  child.stderr.resume();

  return {
    get snapshotCount() {
      return snapshots;
    },
    intervalMilliseconds,
    /** Collects every snapshot taken while the returned window is open. */
    observe(rootPid) {
      const observation = {
        samples: 0,
        treeSamples: 0,
        maxProcessCount: 0,
        peakWorkingSetBytes: null,
        peakPrivateBytes: null,
        osPeakWorkingSetBytes: null,
        accept(rows) {
          observation.samples += 1;
          const tree = walkTree(rows, rootPid);
          if (tree.length === 0) return;
          observation.treeSamples += 1;
          observation.maxProcessCount = Math.max(observation.maxProcessCount, tree.length);
          const workingSet = tree.reduce((total, row) => total + row.WorkingSetSize, 0);
          const priv = tree.reduce((total, row) => total + row.PrivatePageCount, 0);
          // Win32_Process reports this counter in kilobytes, unlike the others.
          const osPeak = tree.reduce((total, row) => total + row.PeakWorkingSetSize * 1024, 0);
          observation.peakWorkingSetBytes = Math.max(observation.peakWorkingSetBytes ?? 0, workingSet);
          observation.peakPrivateBytes = Math.max(observation.peakPrivateBytes ?? 0, priv);
          observation.osPeakWorkingSetBytes = Math.max(observation.osPeakWorkingSetBytes ?? 0, osPeak);
        },
      };
      windows.add(observation);
      return {
        close() {
          windows.delete(observation);
          return {
            method: processTreeSampleMethod,
            intervalMilliseconds,
            samples: observation.samples,
            treeSamples: observation.treeSamples,
            maxProcessCount: observation.maxProcessCount,
            peakWorkingSetBytes: observation.peakWorkingSetBytes,
            peakPrivateBytes: observation.peakPrivateBytes,
            osPeakWorkingSetBytes: observation.osPeakWorkingSetBytes,
          };
        },
      };
    },
    stop() {
      child.kill();
    },
  };
}
