# Safari default-settings compatibility record

This record runs the Phase 1 compiled glTF app in real Safari through the
macOS-provided `safaridriver`; it does not substitute Playwright WebKit for the
shipping browser. The headed run was captured on 2026-08-24 in Safari 18.6 on
macOS 15.6 (Apple Silicon), using default browser feature settings.

## Result

Safari 18.6 did not expose `navigator.gpu`, so the WebGPU renderer could not
start. The app still loaded all 87 glTF hierarchy records and its brand asset,
then presented the expected `WebGPU is unavailable in this browser.` capability
diagnostic. This is a graceful unsupported-browser result, not Safari rendering
conformance evidence.

![Safari WebGPU capability diagnostic](safari-18-macos-webgpu-unavailable.png)

The machine-readable `safari-compatibility.json` records the Safari and macOS
versions, user agent, observed application state, screenshot digest, and the
recorder's limitations. Safari WebDriver does not provide the console event
stream used by the Chrome/Firefox Playwright matrix, so this record makes no
console-cleanliness claim.

## Reproduce

On macOS, enable **Safari > Develop > Allow Remote Automation**, install the
workspace, build the runtime package, and run:

```sh
pnpm --filter @madi/runtime-webgpu run build
pnpm safari:compatibility
```

The default destination is ignored `output/safari-compatibility` storage. A
reviewed record is written and validated with:

```sh
pnpm safari:compatibility -- --output artifacts/browser-safari
pnpm safari:compatibility:check
```

The recorder accepts a future WebGPU-capable Safari only when the canonical
scene reaches its ready state with 34 shared meshes and 85 occurrences. Such a
run needs a new reviewed record and validator expectation; it must not silently
replace this unsupported result.
