# Project-owned IFC fixtures

These small IFC files are authored by NARU contributors and distributed under
the repository's Apache-2.0 license. They exercise adapter contracts without
introducing third-party or proprietary engineering data.

`explicit-edge-wall.ifc` is a deterministic IFC4 swept-solid wall in millimetre
project units. Its rectangular extrusion has 12 OpenCascade face-boundary
segments, all originating from `IfcExtrudedAreaSolid#21`; it is the focused
E2.1 fixture for distinguishing explicit topological boundaries from triangle
wireframes.
