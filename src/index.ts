/**
 * pi-bifrost-reasoning-fix
 *
 * Restores DeepSeek reasoning after tool-calling turns when the provider
 * routes through Bifrost.
 *
 * Bifrost relays DeepSeek reasoning in non-standard fields instead of
 * `reasoning_content`:
 *
 *   - streaming: `delta.reasoning` / `delta.reasoning_details`
 *   - messages:  `reasoning` / `reasoning_details`
 *
 * When a request carries `tools`, DeepSeek requires the assistant
 * `reasoning_content` to be passed back on every subsequent request. Bifrost
 * does not re-expose it, so the replayed history reaches Bifrost with
 * `reasoning_details` and DeepSeek stops reasoning on the next tool-calling
 * turn (and may return an HTTP 400).
 *
 * The `before_provider_request` hook rewrites the provider payload before it is
 * sent so the assistant history is replayed in the field DeepSeek requires.
 *
 * Configuration lives in `~/.pi/agent/extensions/pi-bifrost-reasoning-fix/config.json`
 * (see `src/config.ts`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { normalizePayload, type Payload } from "./normalize.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  const targets: Set<string> = new Set(config.models.map((m) => m.toLowerCase()));

  function appliesTo(model: unknown): boolean {
    if (targets.size === 0) return true; // no models configured -> apply to all
    const id = typeof model === "string" ? model.toLowerCase() : "";
    for (const target of targets) {
      if (id === target || id.startsWith(target)) return true;
    }
    return false;
  }

  function log(level: "error" | "info", msg: string): void {
    if (config.logLevel === "off") return;
    if (level === "error" || config.logLevel === "info") {
      console.error(`[bf-reasoning-fix] ${msg}`);
    }
  }

  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload as Payload | undefined;
    if (!payload) return undefined;
    if (!appliesTo(payload.model)) return undefined;

    // DeepSeek requires every assistant message in a tool-calling history to
    // carry `reasoning_content`. The requirement is driven by *history content*
    // (a prior assistant carried tool_calls), not by whether this request also
    // includes `tools` — pi often re-sends history without `tools` after a tool
    // call, and DeepSeek still drops reasoning. `normalizePayload` (see
    // src/normalize.ts) detects tool-calling from the history and forces
    // `reasoning_content` (even empty) on *all* assistants.
    //
    // Prefix-cache note: the rewrite is deterministic and stable across
    // requests — a given assistant always serializes the same way once
    // tool-calling is in scope, activation is monotonic (a tool_call once
    // present stays in the history), and user/system/tool messages are never
    // touched, so a stable prefix is preserved and the provider prefix cache is
    // not invalidated by this step.
    const result = normalizePayload(payload, config.forceReasoningContentOnTools);
    if (result) {
      log("info", `normalized provider payload (model=${String(payload.model)}, cwd=${ctx.cwd})`);
      return result;
    }
    return undefined;
  });

  pi.on("after_provider_response", (event) => {
    // Reserved for SSE / outlet handling. See README for scope.
    void event;
  });
}
