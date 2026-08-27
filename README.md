# @amartinr/pi-bifrost-reasoning-fix

Pi extension that restores DeepSeek reasoning on tool-calling turns when the
provider sits behind Bifrost.

## Scope

Bifrost relays DeepSeek reasoning in non-standard fields instead of the OpenAI
`reasoning_content`:

- streaming: `delta.reasoning` / `delta.reasoning_details`
- messages:  `reasoning` / `reasoning_details`

In a tool-calling context DeepSeek requires every assistant message to carry
`reasoning_content`, and it derives that requirement from the **history**
(once an assistant has produced a `tool_calls`), not from whether the current
request still ships `tools` — pi often re-sends the history after a tool call
without `tools` in the payload, and DeepSeek still drops reasoning (and may
return an HTTP 400). Bifrost does not re-expose `reasoning_content`, so the
replayed history reaches Bifrost with `reasoning` / `reasoning_details` and
DeepSeek stops reasoning on the next tool-calling turn.

## How it works

The extension registers `before_provider_request` and rewrites the provider
payload before it is sent:

1. Moves assistant `reasoning` / `reasoning_details` text into
   `reasoning_content`.
2. Whenever the history *contains* a tool call (or the request carries
   `tools`), guarantees **every** assistant message carries a
   `reasoning_content` field (empty if none yet), so DeepSeek keeps reasoning.

The rewrite is deterministic and stable across requests, so it does not
invalidate a stable prefix for the provider's prefix cache: a given assistant
message always serializes the same way once tool-calling is in scope, and
user/system/tool messages are never touched (see `src/index.ts`).

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
  "models": ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"],
  "forceReasoningContentOnTools": true,
  "logLevel": "off"
}
```

| Key                            | Type      | Default  | Description                                                                                                                    |
|--------------------------------|-----------|----------|---------------------------------------------------------------------------------------------------------------------------------|
| `models`                       | string[]  | `[]`     | Model IDs (or ID prefixes). Empty applies the fix to every request that carries Bifrost residue.                               |
| `forceReasoningContentOnTools` | boolean   | `true`   | Ensure every assistant message carries `reasoning_content` when the history has a tool call (applies even without `tools`).     |
| `logLevel`                     | string    | `"off"`  | `off` / `error` / `info` diagnostics to stderr.                                                                                   |

## Authentication & credentials

This extension does not send requests to Bifrost. It rewrites the provider
payload in memory; pi itself performs the authenticated HTTP call using the
`apiKey` and `headers` declared in `models.json`. The extension therefore
never sees or forwards credentials, and no secret belongs in its config file.

- Never store an API key in the extension config file; keep it in
  `models.json` (or the environment) as pi expects.
- If the extension ever calls Bifrost directly, use a configurable auth header
  (like `GATEWAY_AUTH_HEADER`/`GATEWAY_AUTH_VALUE`) rather than a hardcoded
  secret.

## Install

The package is not yet published to npm. Install it from source:

Clone the repository (or copy it) into Pi's global extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
cd ~/.pi/agent/extensions
# clone from GitHub
#   git clone git@github.com:amartinr/pi-bifrost-reasoning-fix.git
# or copy an existing checkout into place:
#   cp -r /path/to/pi-bifrost-reasoning-fix .

cd pi-bifrost-reasoning-fix
npm install
npm run build
```

Then reload Pi (`/reload`) so the extension is auto-discovered. Optionally
place a `config.json` in the extension's config path (see
[Configuration](#configuration)).

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

- [`filters/bifrost_reasoning_content_fix`](https://github.com/amartinr/open-webui-extensions/tree/main/filters/bifrost_reasoning_content_fix)
  — same normalization for the Open WebUI → Bifrost path.
- [`pipes/agent_loop_guard`](https://github.com/amartinr/open-webui-extensions/tree/main/pipes/agent_loop_guard)
  — robust SSE forwarding for Bifrost's non-standard stream.
- Upstream Bifrost issues:
  - [maximhq/bifrost#5325](https://github.com/maximhq/bifrost/issues/5325) —
    reasoning emitted in non-standard fields.
  - [maximhq/bifrost#974](https://github.com/maximhq/bifrost/issues/974) —
    streaming `delta.reasoning` dropped for some providers.
  - [maximhq/bifrost#6523](https://github.com/maximhq/bifrost/issues/6523) —
    opening role-only SSE chunks dropped.

## License

MIT
