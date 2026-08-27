# @amartinr/pi-bifrost-reasoning-fix

Pi extension that restores DeepSeek reasoning on tool-calling turns when the
provider sits behind Bifrost.

## Scope

Bifrost relays DeepSeek reasoning in non-standard fields instead of the OpenAI
`reasoning_content`:

- streaming: `delta.reasoning` / `delta.reasoning_details`
- messages:  `reasoning` / `reasoning_details`

When a request carries `tools`, DeepSeek requires the assistant
`reasoning_content` to be passed back on every subsequent request. Bifrost does
not re-expose it, so the replayed history reaches Bifrost with
`reasoning_details` and DeepSeek stops reasoning on the next tool-calling turn
(and may return an HTTP 400).

## How it works

The extension registers `before_provider_request` and rewrites the provider
payload before it is sent:

1. Moves assistant `reasoning` / `reasoning_details` text into
   `reasoning_content`.
2. In tool-calling requests, guarantees every assistant message carries a
   `reasoning_content` field, so DeepSeek keeps reasoning.

The rewrite is content-driven (`reasoning` / `reasoning_details` present) and
gated on the model id (`deepseek/*`), so non-Bifrost providers are untouched.

## SSE (outlet)

`after_provider_response` is a no-op by design. Pi reads streaming reasoning
via the OpenAI SDK, which parses `delta.reasoning` / `delta.reasoning_details`
and tolerates SSE comments (`: heartbeat`) and `data: [DONE]`. The drop occurs
only when history is replayed on the inbound (request) side, which is what this
fixes. No stream rewriting is required on the Pi path.

## Configuration: models.json

The extension does the inbound rewrite, so your `models.json` does not need
hacks to work around the `reasoning` / `reasoning_details` dialect. It only
needs a Bifrost provider whose models declare `reasoning: true` and a sensible
`thinkingLevelMap` so the reasoning toggle works as expected.

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
            "xhigh": "max"
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

- `apiKey` is your Bifrost credential. Keep it in the file as normal for pi, but
  never commit it — the key shown here is a placeholder.
- `supportsReasoningEffort: true` lets pi forward the reasoning level from the
  toggle.
- `thinkingLevelMap.low` maps to the `low` effort level DeepSeek supports so the
  toggle exposes all three levels (`low`, `high`, `max`). Omitted intermediate
  levels (`minimal`, `medium`) stay hidden.
- Any custom gateway headers (`bifrost.headers`) are deployment-specific; keep
  them out of public documentation.

## Configuration

Configuration is read from a JSON file checked at the extension's global config
path:

```
~/.pi/agent/extensions/pi-bifrost-reasoning-fix/config.json
```

If the file is missing, defaults apply. An invalid file falls back to defaults
with a warning.

```json
{
  "baseUrl": "http://<bifrost-host>/v1",
  "models": ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"],
  "forceReasoningContentOnTools": true,
  "logLevel": "off"
}
```

| Key                        | Type   | Default | Description                                                            |
|----------------------------|--------|---------|------------------------------------------------------------------------|
| `baseUrl`                  | string | `""`   | Bifrost gateway base URL (OpenAI-compatible `/v1`) — informational;      |
|                            |        |         | used by tooling and diagnostics. Falls back to `BIFROST_BASE_URL`.       |
| `models`                   | string[] | `[]`  | Model IDs (or ID prefixes). Empty applies the fix to every request      |
|                            | absent |         | that carries Bifrost residue.                                           |
|                            | absent |         | that carries Bifrost residue.                                           |
| `forceReasoningContentOnTools` | bool | `true` | Add an empty `reasoning_content` to assistant messages in tool-calling   |
|                            |        |         | requests so DeepSeek keeps reasoning.                                    |
| `logLevel`                 | string | `"off"` | `off` / `error` / `info` diagnostics to stderr.                          |

## Install

Add to your Pi environment (placed in `~/.pi/agent/extensions/` for global
autodiscovery), or run from a trusted project:

```bash
npm install @amartinr/pi-bifrost-reasoning-fix
```

## Development

```bash
npm install
npm run build
npm run typecheck
```

## Publish

The package is scoped to `@amartinr` and published public. `prepublishOnly`
runs the build so `dist/` is always current.

## Related

- `filters/bifrost_reasoning_content_fix` (open-webui-extensions) — the same
  normalization for the Open WebUI → Bifrost path.

## License

MIT
