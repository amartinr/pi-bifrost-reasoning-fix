# @amartinr/pi-bifrost-reasoning-fix

Pi extension that restores DeepSeek reasoning on tool-calling turns when the provider routes through Bifrost.

## Problem

Bifrost relays DeepSeek reasoning in non-standard fields instead of the OpenAI `reasoning_content`:

- streaming: `delta.reasoning` / `delta.reasoning_details`
- messages: `reasoning` / `reasoning_details`

DeepSeek requires every assistant message in a tool-calling context to carry `reasoning_content`. The requirement derives from history content — once an assistant has produced `tool_calls` — not from whether the current request still ships `tools`. pi often re-sends history after a tool call without `tools` in the payload; DeepSeek still drops reasoning and may return an HTTP 400. Bifrost does not re-expose `reasoning_content`, so the replayed history reaches Bifrost with `reasoning` / `reasoning_details` and DeepSeek stops reasoning on the next tool-calling turn.

## Mechanism

The extension registers `before_provider_request` and rewrites the provider payload before it is sent:

1. Moves assistant `reasoning` / `reasoning_details` text into `reasoning_content`.
2. When the history contains a tool call (or the request carries `tools`), guarantees every assistant message carries a `reasoning_content` field (empty if none yet), so DeepSeek keeps reasoning.

The rewrite is deterministic and stable across requests: a given assistant message always serializes identically once tool-calling is in scope, and user/system/tool messages are never touched. A stable prefix is therefore preserved for the provider's prefix cache.

The rename step is content-driven — it fires only when an assistant message carries `reasoning` / `reasoning_details`. The forcing step is not content-driven: it fires for any tool-calling payload (request `tools` or tool-call history). Model gating is defined by the extension configuration (see [Extension configuration](#extension-configuration-configjson)).

## Scope of application

The extension applies to the model IDs listed under `models` in the extension configuration, matched by exact ID or prefix.

- **Missing config file or empty `models` list** — the extension applies to every request. In this mode the forcing step also touches tool-calling payloads from other providers, which may reject unknown `reasoning_content` fields.
- **Listed models** — the extension applies only to those models. Listing the DeepSeek models routed through Bifrost is the recommended setup.

## Streaming (outlet)

`after_provider_response` is a no-op by design. pi reads streaming reasoning via the OpenAI SDK, which parses `delta.reasoning` / `delta.reasoning_details` and tolerates SSE comments (`: heartbeat`) and `data: [DONE]`. The drop occurs only when history is replayed on the inbound (request) side, which this extension fixes. No stream rewriting is required on the pi path.

## Provider configuration (models.json)

The extension performs the inbound rewrite, so `models.json` does not need workarounds for the `reasoning` / `reasoning_details` dialect. It requires a Bifrost provider whose models declare `reasoning: true` and a `thinkingLevelMap` aligned with DeepSeek's official effort levels.

```json
{
  "providers": {
    "bifrost": {
      "baseUrl": "http://<bifrost-host>/v1",
      "api": "openai-completions",
      "apiKey": "<your-api-key>",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": true
      },
      "models": [
        {
          "id": "deepseek/deepseek-v4-flash",
          "name": "DeepSeek V4 Flash (Bifrost)",
          "reasoning": true,
          "thinkingLevelMap": {
            "minimal": null,
            "low": "low",
            "medium": null,
            "high": "high",
            "xhigh": null,
            "max": "max"
          },
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 384000
        }
      ]
    }
  }
}
```

Notes:

- `apiKey` is your Bifrost credential. Keep it in the file as usual for pi; never commit it. The key shown here is a placeholder.
- `supportsReasoningEffort: true` lets pi forward the reasoning level from the toggle.
- `thinkingLevelMap` exposes DeepSeek's three official effort levels (`low`, `high`, `max`) using exactly those values, so only `reasoning_effort` values DeepSeek documents are ever sent. The intermediate pi levels (`minimal`, `medium`, `xhigh`) map to `null` (hidden). This avoids sending `medium`/`xhigh` — which DeepSeek silently re-maps to `high` and a strict gateway like Bifrost may reject.
- Gateway-specific headers (`bifrost.headers`) are deployment-specific; keep them out of public documentation.

## Extension configuration (config.json)

Configuration is read from a JSON file at the extension's global config path:

```
~/.pi/agent/extensions/pi-bifrost-reasoning-fix/config.json
```

A missing file applies defaults. An invalid file falls back to defaults with a warning.

The `models` list determines which requests the fix rewrites. In the example below, only the two DeepSeek models are affected.

```json
{
  "models": ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"],
  "forceReasoningContentOnTools": true,
  "logLevel": "off"
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `models` | string[] | `[]` | Model IDs (or prefixes) to which the fix applies. An empty list applies the fix to every request. |
| `forceReasoningContentOnTools` | boolean | `true` | Ensures every assistant message carries `reasoning_content` when the history has a tool call (applies even without `tools`). |
| `logLevel` | string | `"off"` | `off` / `error` / `info` diagnostics to stderr. |

## Credentials

The extension does not send requests to Bifrost. It rewrites the provider payload in memory; pi performs the authenticated HTTP call using the `apiKey` and `headers` declared in `models.json`. The extension never sees or forwards credentials, and no secret belongs in its config file.

- Never store an API key in the extension config file; keep it in `models.json` (or the environment) as pi expects.
- If the extension ever calls Bifrost directly, use a configurable auth header (like `GATEWAY_AUTH_HEADER`/`GATEWAY_AUTH_VALUE`) rather than a hardcoded secret.

## Installation

Install the package as a pi package:

```bash
pi install npm:@amartinr/pi-bifrost-reasoning-fix
```

Alternatively, add it to `packages` in `~/.pi/agent/settings.json` and reload pi (`/reload`) so the extension is auto-discovered.

After installation, create the extension configuration and list the target models (see [Extension configuration](#extension-configuration-configjson)). Without a config file, the extension applies to every request.

## Development

```bash
npm install
npm run build
npm run typecheck
```

## Publishing

The package is scoped to `@amartinr` and published public. `prepublishOnly` runs the build so `dist/` is always current.

## References

- [`filters/bifrost_reasoning_content_fix`](https://github.com/amartinr/open-webui-extensions/tree/master/filters/bifrost_reasoning_content_fix) — same normalization for the Open WebUI → Bifrost path.
- [`pipes/agent_loop_guard`](https://github.com/amartinr/open-webui-extensions/tree/master/pipes/agent_loop_guard) — robust SSE forwarding for Bifrost's non-standard stream.
- Upstream Bifrost issues:
  - [maximhq/bifrost#5325](https://github.com/maximhq/bifrost/issues/5325) — reasoning emitted in non-standard fields.
  - [maximhq/bifrost#974](https://github.com/maximhq/bifrost/issues/974) — streaming `delta.reasoning` dropped for some providers.
  - [maximhq/bifrost#6523](https://github.com/maximhq/bifrost/issues/6523) — opening role-only SSE chunks dropped.

## License

MIT
