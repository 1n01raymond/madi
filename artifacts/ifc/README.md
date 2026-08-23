# IFC federation evidence

This directory contains compact, reviewable evidence from real IFC federation
compilations. Source IFC files, expanded Scene IR, and compiled geometry remain
outside Git because they are large reproducible inputs or derived caches.

| Dataset | Evidence role |
|---|---|
| `digital-hub/` | First four-discipline IFC → Scene IR → glTF vertical slice |

Normal CI runs `pnpm ifc:federation:check` without downloading IFC files or
installing IfcOpenShell. Re-recording evidence requires the pinned external
fixture and Python adapter documented in the dataset directory.
