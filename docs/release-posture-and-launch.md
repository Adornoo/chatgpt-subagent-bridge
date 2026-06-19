# Release Posture And Launch Notes

Last updated: 2026-06-19

`chatgpt-subagent-bridge` is now released as a public GitHub source repository under the MIT License.

## Current Posture

- GitHub repository: public.
- License: MIT.
- Forking: allowed by GitHub visibility and MIT licensing.
- Source reuse and modification: allowed under the MIT License.
- Package metadata: `private: true`.
- npm publication: not approved and intentionally disabled.
- Distribution: source checkout only.

This means people may view, fork, use, modify, and redistribute the code under the MIT License, but the project is not currently published as an npm package.

## Why `private: true` Remains

`private: true` in `package.json` is an npm safety switch. It does not make the GitHub repository private and does not conflict with the MIT License.

It remains in place because npm publication needs separate decisions:

- whether to publish TypeScript source directly or build JavaScript output,
- which package name and release cadence to support,
- what compatibility guarantees to make,
- how issues and security reports should be triaged for package users.

## Before Any npm Package Release

Before publishing to npm:

- remove or change `private: true`,
- run the test suite,
- run the package dry-run check,
- decide whether build output is required,
- add release notes and versioning expectations,
- confirm public docs describe npm installation accurately.

## Current Recommendation

Use GitHub as the public source and fork surface for v0.1. Keep npm publication disabled until there is a clear reason to support package consumers.
