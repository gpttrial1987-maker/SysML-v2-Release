# Fork Survey Findings

This note distills fork research into the areas the core team cares about most: OpenAPI refinements, performance-focused changes, and browser-friendly experiences. Each section lists what we observed, how it could roll into upstream work, and specific patches worth cherry-picking.

## SDK fork with OpenAPI refinements

* **What it adds.** The fork maintains a generated client that wraps the OpenAPI surface with runtime validation, typed error reporting, and automatic retry/backoff semantics. It also layers a higher-level `SysMLSDK` that can emit SysML-text or API-JSON bundles with stable manifests and checksums.
* **Suggested upstream PR(s).**
  1. *Typed REST client with resilient retries* – land the generated client and error model so downstream tools see consistent validation failures.
  2. *Bundle export helpers* – contribute the manifest/bundle helpers and SysML-text serialization as a distinct feature flag for the SDK.
* **Cherry-pick targets.** `src/generated/client.ts`, `src/generated/schemas.ts`, `src/generated/types.ts`, and `src/sysml-sdk.ts` capture the end-to-end stack.

## Lightweight validation & pagination performance fork

* **What it adds.** A bespoke `zod-lite` runtime replaces heavyweight schema dependencies while retaining familiar parsing ergonomics. The SDK’s bundle export path batches API calls with `Promise.all`, guards pagination with a seen-cursor set, and sorts elements deterministically before serialization.
* **Suggested upstream PR(s).**
  1. *Adopt light schema runtime for generated clients* – ship `zod-lite` (or equivalent) as an internal helper to reduce bundle size and validation cost.
  2. *Stabilise export pagination* – promote the pagination/loop guards into mainline so large projects export reliably.
* **Cherry-pick targets.** `src/utils/zod-lite.ts` plus the pagination helpers inside `src/sysml-sdk.ts`.

## Browser-friendly editing fork

* **What it adds.** Two browser experiences: a static CodeMirror-based editor with heuristic outline, file import/export, API-backed outline sync, and a Vue/Monaco workbench that layers commit timelines, tag management, and diff utilities directly in the browser.
* **Suggested upstream PR(s).**
  1. *Publish standalone web editor sample* – upstream the static editor as documentation-grade tooling.
  2. *Ship Monaco workbench for pilot usage* – gate the Vue app behind a preview flag to gather feedback on timeline/diff workflows.
* **Cherry-pick targets.** `doc/web-editor/**` for the static variant and `apps/vue-monaco-editor/**` for the richer Monaco experience.
