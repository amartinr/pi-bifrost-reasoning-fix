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
