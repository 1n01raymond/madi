# IFC federation evidence

This directory contains compact, reviewable evidence from real IFC federation
runs. Source IFC files, intermediate Scene IR, and compiled geometry remain
outside Git because they are large reproducible inputs or derived caches.

| Dataset | Evidence role |
|---|---|
| `digital-hub/` | First four-discipline IFC → Scene IR → glTF vertical slice |
| `sixty5/` | First real-large seven-discipline extraction and the measured compiler boundary |
| `sixty5-browser/` | Original real-large browser/residency record and 268.0 s first-frame baseline |
| `sixty5-first-frame/` | Shared-coarse follow-up: 12.796 s median first frame on the identical package |

Normal CI runs `pnpm ifc:federation:check` without downloading IFC files or
installing IfcOpenShell. Re-recording evidence requires the pinned external
fixture and Python adapter documented in the dataset directory.
