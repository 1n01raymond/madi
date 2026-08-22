# MADI brand assets

The MADI mark is an engineering solid that extends past a viewport frame. The
frame is the browser; the solid is a scene larger than any single view. Faces
are unshaded — form is carried by explicit edges, the same principle the runtime
applies to CAD geometry.

The identity is monochrome. There is no brand hue: `#111111` on `#FFFFFF`, and
the inverse. This keeps the mark legible in READMEs, terminals, print, embedded
viewers, and any host application's chrome.

| Asset | Intended use |
|---|---|
| [`madi-hero.svg`](madi-hero.svg) | Repository, documentation, and presentation headers |
| [`madi-mark.svg`](madi-mark.svg) | Square avatars, application icons, and compact placements |
| [`madi-mark-inverse.svg`](madi-mark-inverse.svg) | The mark on dark surfaces |
| [`madi-favicon.svg`](madi-favicon.svg) | Simplified variant for 16–32 px placements |

## Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#111111` | Mark, wordmark, frame |
| Paper | `#FFFFFF` | Ground and knocked-out geometry |
| Graphite | `#6E6F73` | Tagline and secondary lockup text |
| Hairline | `#E6E6E4` | Banner border and rules |

## Type

The wordmark is set in **Space Grotesk** Bold with `+2` tracking; the tagline in
**JetBrains Mono** Medium with `+6.4` tracking. Both are available under the SIL
Open Font License. Fall back to the system sans and mono stacks.

## Usage

Keep the mark's proportions. Provide clear space equal to the height of the
viewport frame's corner radius on all sides. Below 32 px use
`madi-favicon.svg`, which merges the internal edges into a single stroke
weight. Do not add a hue, gradient, or shadow to the mark, and do not separate
the solid from the frame — the overlap is the idea.

Until a separate trademark policy is adopted, these assets are distributed
under the repository's [Apache License 2.0](../../LICENSE).
