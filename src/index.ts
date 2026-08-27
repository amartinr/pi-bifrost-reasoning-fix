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

interface ProviderMessage {
  role?: string;
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
  tool_calls?: unknown;
}

interface ReasoningDetail {
  type?: unknown;
  text?: unknown;
}

interface Payload {
  model?: unknown;
  messages?: ProviderMessage[];
  tools?: unknown[];
  [key: string]: unknown;
}

const REASONING_TEXT_TYPE = "reasoning.text";

function hasReasoningResidue(msg: ProviderMessage | undefined | null): boolean {
  return !!(
    msg &&
    (Array.isArray(msg.reasoning_details) ||
      typeof msg.reasoning === "string")
  );
}

function extractReasoningText(details: unknown): string {
  if (!Array.isArray(details)) return "";
  let out = "";
  for (const item of details) {
    if (
      item &&
      typeof item === "object" &&
      (item as ReasoningDetail).type === REASONING_TEXT_TYPE &&
      typeof (item as ReasoningDetail).text === "string"
    ) {
      out += (item as ReasoningDetail).text;
    }
  }
  return out;
}

function normalizeAssistant(msg: ProviderMessage | undefined): void {
  if (!msg) return;
  const details = msg.reasoning_details;

  if (
    typeof msg.reasoning === "string" &&
    typeof msg.reasoning_content === "undefined"
  ) {
    msg.reasoning_content = msg.reasoning;
  }
  delete msg.reasoning;

  if (
    details &&
    (typeof msg.reasoning_content !== "string" || msg.reasoning_content === "")
  ) {
    const text = extractReasoningText(details);
    if (text) msg.reasoning_content = text;
  }
  delete msg.reasoning_details;
}

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
    if (!payload || !Array.isArray(payload.messages)) return undefined;
    if (!appliesTo(payload.model)) return undefined;

    const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
    let touched = false;

    for (const msg of payload.messages) {
      if (!msg || msg.role !== "assistant") continue;
      if (hasReasoningResidue(msg)) {
        normalizeAssistant(msg);
        touched = true;
      }
    }

    if (config.forceReasoningContentOnTools && hasTools && !touched) {
      for (const msg of payload.messages) {
        if (msg && msg.role === "assistant") {
          if (typeof msg.reasoning_content !== "string") {
            msg.reasoning_content = "";
            touched = true;
          }
        }
      }
    }

    if (touched) {
      log("info", `normalized provider payload (model=${String(payload.model)}, cwd=${ctx.cwd})`);
      return payload;
    }
    return undefined;
  });

  pi.on("after_provider_response", (event) => {
    // Reserved for SSE / outlet handling. See README for scope.
    void event;
  });
}
