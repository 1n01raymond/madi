# Translating MADI

MADI welcomes readers and contributors in their preferred language. During the
early vertical-slice phase, the repository localizes the project landing page while
keeping detailed design documents in English so technical decisions have one
reviewable source of truth.

## Available README translations

| Language | File | Status |
|---|---|---|
| English | [`README.md`](../README.md) | Canonical source |
| Korean | [`README.ko.md`](../README.ko.md) | Initial translation; review welcome |
| Japanese | [`README.ja.md`](../README.ja.md) | Initial translation; native-speaker review requested |
| Simplified Chinese | [`README.zh-CN.md`](../README.zh-CN.md) | Initial translation; native-speaker review requested |

Translation status describes editorial review, not completeness of the MADI
software. Every README must show the same project-stage warning prominently.

## File naming

Use a BCP 47 language tag when a regional or script distinction matters:

```text
README.<language-tag>.md
```

Examples: `README.ko.md`, `README.ja.md`, `README.zh-CN.md`, and
`README.pt-BR.md`.

## Translation workflow

1. Open an issue for a new language so duplicate efforts can coordinate.
2. Copy `README.md`; do not translate from another translation.
3. Keep links, tables, status warnings, and technical claims aligned with the
   English source.
4. Add the language to the selector at the top of every README.
5. Add the translation to the status table above.
6. Request review from a fluent speaker, especially for CAD/BIM terminology.

Translation pull requests may improve natural phrasing without mirroring English
sentence structure. They must not change product scope or architecture claims;
make those changes in the English source first.

## Terminology guidance

Some terms are intentionally left in English because they are identifiers or
widely used technical concepts. Use surrounding prose to clarify them where
needed.

| Canonical term | Meaning in MADI |
|---|---|
| source of truth | The authoritative native document or upstream system |
| Engineering Scene IR | The logical internal boundary; not a CAD exchange format |
| prototype | Shared object definition referenced by occurrences |
| occurrence | One placed instance in an assembly hierarchy |
| hot path | Per-frame or interaction-critical work |
| residency | Which decoded resources currently occupy CPU/GPU memory |
| Studio | The reference MADI end-user application |
| Runtime | The embeddable browser and GPU engine |

## Keeping translations current

A pull request that materially changes `README.md` should update the language
selector everywhere and mark affected translations for follow-up in this file.
Minor copy edits do not need to block a technical change. Translators can use
the Git history of `README.md` to review only the changed sections.
