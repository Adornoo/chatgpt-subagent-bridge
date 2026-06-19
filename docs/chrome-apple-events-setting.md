# Chrome Apple Events Setting

This note explains the browser setting that the live Chrome bridge depends on.

## What The Setting Is

Chrome hides a developer option at:

`View > Developer > Allow JavaScript from Apple Events`

When this option is turned on, Chrome allows trusted local automation tools on the Mac to run page-level JavaScript through Apple Events.

## Why The Bridge Needs It

The current v0.1 bridge adapter uses AppleScript to:

- focus an existing logged-in ChatGPT tab in Chrome,
- insert the already-redacted task packet into the ChatGPT composer,
- click send,
- poll the page for the assistant reply,
- stop cleanly with a recorded blocker if the page is not in a usable state.

Without this Chrome setting, the adapter can still open or focus Chrome, but it cannot interact with the ChatGPT page itself.

## Risk And Benefit

Benefit:

- enables the current local-only bridge path without giving ChatGPT direct filesystem, shell, or tunnel access,
- keeps the bridge operator as the only local actor that owns files, tests, commits, and validation,
- preserves the existing fail-closed packet-first design.

Risk:

- this is a persistent Chrome browser setting, not a one-time prompt,
- other trusted local automation on the same Mac could also use Apple Events to run page JavaScript in Chrome while the setting remains enabled,
- it expands local browser automation capability even though the bridge itself still stays packet-first and local-filesystem-safe.

## Approval Boundary

Do not enable this setting implicitly or as a hidden side effect.

The operator should make an explicit, informed choice before using the Chrome route.

## Manual Steps

1. Open `Google Chrome`.
2. In the menu bar, choose `View`.
3. If `Developer` is hidden, first enable it from Chrome's own developer menu visibility flow if needed.
4. Open `View > Developer`.
5. Turn on `Allow JavaScript from Apple Events`.
6. Keep Chrome signed in to ChatGPT.
7. Rerun the harmless bridge smoke test.

## How To Turn It Back Off

1. Open `Google Chrome`.
2. Choose `View > Developer`.
3. Turn off `Allow JavaScript from Apple Events`.

## Current Expected Behavior

The Chrome route is expected to work only when ChatGPT is already logged in and the running Chrome app has this setting enabled.

There are still two known fail-closed cases to expect on future runs:

- If the setting is still off, the bridge should record a blocker artifact saying Chrome blocked automation because `Allow JavaScript from Apple Events` is disabled.
- If the preference was enabled after Chrome was already running, the bridge may still record `Access not allowed`. In practice that means the running Chrome app still needs a restart or a manual toggle of `View > Developer > Allow JavaScript from Apple Events`.

Recommended first live check:

- Prompt: `Reply with exactly this text and nothing else: BRIDGE_OK`
- Expected result: `BRIDGE_OK`
- Expected verdict: `pass`
