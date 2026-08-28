# Safari default-settings compatibility record

This record runs the Phase 1 compiled glTF app in real Safari through the
macOS-provided `safaridriver`; it does not substitute Playwright WebKit for the
shipping browser. The headed run was captured on 2026-08-28 in Safari 26.6.1 on
macOS 15.6 (Apple Silicon), using default browser feature settings. It
supersedes the 2026-08-24 Safari 18.6 record on the same host, which is
preserved in Git history.

## Result

Safari 26.6.1 on macOS Sequoia still does not expose `navigator.gpu` under
default settings, so the WebGPU renderer could not start. Apple ships WebGPU
enabled by default only in Safari 26 on macOS 26 (Tahoe), iOS 26, iPadOS 26,
and visionOS 26; on macOS Sequoia the WebGPU feature flag remains an unchecked
"Preview" entry ([WebKit bug 299237](https://bugs.webkit.org/show_bug.cgi?id=299237)).
The app still loaded all 87 glTF hierarchy records and its brand asset, then
presented the expected `WebGPU is unavailable in this browser.` capability
diagnostic. This is a graceful unsupported-browser result, not Safari rendering
conformance evidence.

Since the Safari 18.6 record, the assembly panel became a virtualized list, so
the DOM holds only the rows the scrollport covers. The record therefore pins
the total through the `87 occurrence records ready` hierarchy result and keeps
the observed virtualized row count (15 at the recorded viewport) as an
informational value the validator only bounds-checks. The evidence schema
migrated from `madi.safari-compatibility.1` to `naru.safari-compatibility.2`
with this bump (ADR-0007).

![Safari WebGPU capability diagnostic](safari-26-macos-webgpu-unavailable.png)

The machine-readable `safari-compatibility.json` records the Safari and macOS
versions, user agent, observed application state, screenshot digest, and the
recorder's limitations. Safari WebDriver does not provide the console event
stream used by the Chrome/Firefox Playwright matrix, so this record makes no
console-cleanliness claim.

## Reproduce

On macOS, enable **Safari > Develop > Allow Remote Automation**, install the
workspace, build the workspace packages, and run:

```sh
pnpm build
pnpm safari:compatibility
```

The default destination is ignored `output/safari-compatibility` storage. A
reviewed record is written and validated with:

```sh
pnpm safari:compatibility -- --output artifacts/browser-safari
pnpm safari:compatibility:check
```

The recorder accepts a WebGPU-capable Safari only when the canonical scene
reaches its ready state with 34 shared meshes and 85 occurrences. Such a run —
expected once the host runs Safari 26 on macOS 26 (Tahoe) or newer — needs a
new reviewed record and validator expectation; it must not silently replace
this unsupported result.
