# Public MIT Launch Report - 2026-06-19

## Result

The project is launched as a public GitHub repository under the MIT License:

- Repository: `Adornoo/chatgpt-subagent-bridge`
- URL: https://github.com/Adornoo/chatgpt-subagent-bridge
- Visibility: public
- Default branch: `main`
- License: MIT
- Local branch: `main`

## Current Release Posture

The repository is:

- public,
- MIT-licensed,
- forkable,
- source-checkout first,
- not npm-published.

`private: true` intentionally remains in `package.json` to prevent accidental npm publication. That npm setting does not make the GitHub repository private.

## Verification Before Public Launch

- `npm test`: passing.
- `npm pack --dry-run` with a temporary npm cache: clean intentional package surface.
- Current-tree secret scan: no real secrets found; only deliberate fake private-key fixtures in redaction tests.
- `bridge_runs/`: not present in the package tree.

## What Is Still Not Launched

This is not an npm launch.

Before npm publication, the project still needs:

- an explicit npm-release decision,
- a decision on TypeScript-source versus built JavaScript output,
- package-consumer support expectations,
- final installation docs for npm users,
- a versioned release note.

## Recommendation

Treat v0.1 as a public source release and fork surface. Keep npm disabled until the bridge has enough outside-user demand to justify package support.
