# STEP fixtures

Phase 0 requires public or explicitly redistributable STEP assemblies. A file is
not committed here merely because it can be downloaded without authentication.
Its redistribution terms, original URL, checksum, and intended test purpose must
all be reviewable.

`manifest.json` is the source of truth. Each future entry has this shape:

```json
{
  "id": "repeated-fasteners",
  "path": "repeated-fasteners.step",
  "sourceUrl": "https://example.org/source",
  "license": "CC0-1.0",
  "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
  "sha256": "64 lowercase hexadecimal characters",
  "purposes": ["assembly", "instancing", "explicit-edges"],
  "attribution": "Original author or organization"
}
```

## Acceptance checklist

- The license explicitly permits redistribution, modification, and automated
  testing.
- The downloaded file checksum matches the manifest.
- Attribution and the original source URL are retained.
- The file exercises a named Phase 0 risk rather than adding opaque test data.
- A fixture inspection report records units, hierarchy depth, prototype and
  occurrence counts, face/edge counts, warnings, and unsupported entities.

The manifest is intentionally empty at bootstrap. Selecting and reviewing a
real assembly is a tracked Phase 0 outcome; licensing uncertainty is reported,
not silently accepted.
