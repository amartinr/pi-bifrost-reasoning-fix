/**
 * Pure payload normalization for the Bifrost → DeepSeek reasoning fix.
 *
 * Kept free of any pi / ExtensionAPI import so it can be unit-tested and reused
 * outside a pi session. `scripts/verify-fix.mjs` mirrors this by hand (kept
 * dependency-free for standalone env runs); keep the two in sync.
 */

export interface ProviderMessage {
  role?: string;
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
  tool_calls?: unknown;
}

export interface ReasoningDetail {
  type?: unknown;
  text?: unknown;
}

export interface Payload {
  model?: unknown;
  messages?: ProviderMessage[];
  tools?: unknown[];
  [key: string]: unknown;
}

const REASONING_TEXT_TYPE = "reasoning.text";

export function hasReasoningResidue(
  msg: ProviderMessage | undefined | null
): boolean {
  return !!(
    msg &&
    (Array.isArray(msg.reasoning_details) ||
      typeof msg.reasoning === "string")
  );
}

export function extractReasoningText(details: unknown): string {
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

export function normalizeAssistant(msg: ProviderMessage | undefined): void {
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

/**
 * True when the request's history contains a prior assistant that produced a
 * tool call. DeepSeek requires `reasoning_content` on every assistant once the
 * *history* has tool-calling, regardless of whether this request still ships
 * `tools`.
 */
export function historyHasToolCalls(messages: ProviderMessage[]): boolean {
  return messages.some(
    (m) => m && m.role === "assistant" && Array.isArray(m.tool_calls) && (m.tool_calls as unknown[]).length > 0
  );
}

/**
 * Normalizes a provider payload in place. Returns the same payload if anything
 * was rewritten / touched, or `undefined` if it was already conformant (so the
 * caller can leave the provider payload unchanged). Never touches
 * user/system/tool messages, and is deterministic per assistant message.
 */
export function normalizePayload(
  payload: Payload | undefined,
  forceReasoningContentOnTools = true
): Payload | undefined {
  if (!payload || !Array.isArray(payload.messages)) return undefined;

  let touched = false;
  for (const msg of payload.messages) {
    if (!msg || msg.role !== "assistant") continue;
    if (hasReasoningResidue(msg)) {
      normalizeAssistant(msg);
      touched = true;
    }
  }

  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;

  if (forceReasoningContentOnTools && (hasTools || historyHasToolCalls(payload.messages))) {
    for (const msg of payload.messages) {
      if (msg && msg.role === "assistant") {
        if (typeof msg.reasoning_content !== "string") {
          msg.reasoning_content = "";
          touched = true;
        }
      }
    }
  }

  return touched ? payload : undefined;
}
