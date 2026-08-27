# Changelog

All notable changes to this project are documented in this file.

## [0.2.1] - 2026-08-27

### Fixed

- Broken links in the README's *Related* section: `open-webui-extensions`
  uses the `master` branch, but the links pointed at `tree/main`, returning
  404.

## [0.2.0] - 2026-08-27

### Fixed

- Reasoning drop after the first tool-calling turn. DeepSeek requires every
  assistant message to carry `reasoning_content` once the **history** contains
  a tool call, regardless of whether the current request still ships `tools`
  (pi often re-sends history without `tools` after a tool call). The forcing
  now triggers off the history (`historyHasToolCalls`), not just
  `payload.tools`, and covers **all** assistant messages instead of only the
  first one with Bifrost residue.
- Extracted the normalization into a pure, importable and unit-tested module
  (`src/normalize.ts`), with `test/normalize.test.mjs` covering the regression
  case and the prefix-cache stability/idempotency guarantee. Unit tests are
  runnable via `npm test`.

### Added

- Published to npm as `@amartinr/pi-bifrost-reasoning-fix`. Ships a compiled
  `dist/` (ESM + type declarations); `main`, `types` and `pi.extensions` now
  point at `dist/index.js`. `prepublishOnly` builds `dist/` before publish so
  the tarball is always current.
- README documents installing from npm (`pi install
  npm:@amartinr/pi-bifrost-reasoning-fix`).
- Documented `thinkingLevelMap` using only DeepSeek's official effort levels
  (`low`, `high`, `max`); the intermediate pi levels (`minimal`, `medium`,
  `xhigh`) map to `null`. Only `reasoning_effort` values DeepSeek documents are
  ever sent.

## [0.1.0] - 2026-08-27

### Added

- `before_provider_request` payload normalization: replay assistant history
  in `reasoning_content` instead of the non-standard Bifrost fields
  (`reasoning` / `reasoning_details`). Restores DeepSeek reasoning on
  tool-calling turns.
- Loaded from source (`src/index.ts`) so the package installs from git without
  committing a `dist/` build.
- JSON configuration file (`config.json`) in the pi-searxng style at
  `~/.pi/agent/extensions/pi-bifrost-reasoning-fix/config.json`, with
  `models`, `forceReasoningContentOnTools`, and `logLevel` options.
- In tool-calling requests, guarantee every assistant message carries a
  `reasoning_content` field (required by DeepSeek).
- Regression script against a live Bifrost endpoint (`scripts/verify-fix.mjs`).
- Package and repository scaffolding for `@amartinr/pi-bifrost-reasoning-fix`.
