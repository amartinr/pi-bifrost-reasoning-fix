# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-08-27

### Added

- `before_provider_request` payload normalization: replay assistant history
  in `reasoning_content` instead of the non-standard Bifrost fields
  (`reasoning` / `reasoning_details`). Restores DeepSeek reasoning on
  tool-calling turns.
- JSON configuration file (`config.json`) in the pi-searxng style at
  `~/.pi/agent/extensions/pi-bifrost-reasoning-fix/config.json`, with
  `models`, `forceReasoningContentOnTools`, and `logLevel` options.
- In tool-calling requests, guarantee every assistant message carries a
  `reasoning_content` field (required by DeepSeek).
- Regression script against a live Bifrost endpoint (`scripts/verify-fix.mjs`).
- Package and repository scaffolding for `@amartinr/pi-bifrost-reasoning-fix`.
