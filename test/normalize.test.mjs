// Unit tests for src/normalize.ts — run with: node --test test/*.test.mjs
// (or `npm test`). These cover the payload normalization without needing a
// live Bifrost endpoint; regression against the live provider is in
// scripts/verify-fix.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePayload,
  hasReasoningResidue,
  historyHasToolCalls,
} from "../src/normalize.ts";

function asst(extra = {}) {
  return { role: "assistant", content: "voy a listar", ...extra };
}

const sys = { role: "system", content: "agente" };
const usr = { role: "user", content: "haz ls" };
const toolMsg = {
  role: "tool",
  tool_call_id: "c1",
  name: "bash",
  content: "proc.c",
};
const theToolCall = [
  { id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
];

test("normalizePayload renames reasoning_details -> reasoning_content (extracts text)", () => {
  const payload = {
    model: "deepseek/deepseek-v4-flash",
    messages: [
      sys,
      usr,
      asst({ reasoning_details: [{ type: "reasoning.text", text: "debo listar", index: 0 }] }),
      usr,
    ],
  };
  const out = normalizePayload(payload);
  assert.equal(out, payload, "returns same payload when touched");
  const asstMsg = payload.messages[2];
  assert.equal(asstMsg.reasoning_content, "debo listar");
  assert.equal(asstMsg.reasoning_details, undefined);
});

test("normalizePayload renames string `reasoning` -> reasoning_content", () => {
  const payload = {
    model: "m",
    messages: [sys, usr, asst({ reasoning: "razonando" }), usr],
  };
  normalizePayload(payload);
  assert.equal(payload.messages[2].reasoning_content, "razonando");
  assert.equal(payload.messages[2].reasoning, undefined);
});

test("normalizePayload with tool_call in history forces reasoning_content on ALL assistants (even without tools in payload)", () => {
  const payload = {
    model: "m",
    messages: [
      sys,
      usr,
      asst({ tool_calls: theToolCall }), // <-- assistant with tool call, no reasoning
      toolMsg,
      asst({ content: "resumo tras la tool" }), // <-- second assistant, also no reasoning
      usr,
    ],
    // NOTE: no `tools` key at all — the regression case
  };
  const out = normalizePayload(payload);
  assert.equal(out, payload, "touched");
  assert.equal(payload.messages[2].reasoning_content, "");
  assert.equal(payload.messages[4].reasoning_content, "");
});

test("normalizePayload does NOT force reasoning_content when there is no tool-calling anywhere", () => {
  const payload = {
    model: "m",
    messages: [sys, usr, asst({ content: "respuesta normal" }), usr],
  };
  const out = normalizePayload(payload);
  assert.equal(out, undefined, "not touched");
  assert.equal(payload.messages[2].reasoning_content, undefined);
});

test("normalizePayload with tools in payload forces reasoning_content even with no tool_calls history", () => {
  const payload = {
    model: "m",
    tools: [{ type: "function", function: { name: "bash" } }],
    messages: [sys, usr, asst({}), usr],
  };
  const out = normalizePayload(payload);
  assert.equal(out, payload, "touched via tools");
  assert.equal(payload.messages[2].reasoning_content, "");
});

test("normalizePayload respects forceReasoningContentOnTools=false", () => {
  const payload = {
    model: "m",
    messages: [sys, usr, asst({ tool_calls: theToolCall }), toolMsg, usr],
  };
  const out = normalizePayload(payload, false);
  assert.equal(out, undefined, "no forcing when disabled");
  assert.equal(payload.messages[2].reasoning_content, undefined);
});

test("normalizePayload is idempotent: already-conformant tool payload is left untouched (undefined) and reasoning_content is kept", () => {
  const payload = {
    model: "m",
    messages: [sys, usr, asst({ reasoning_content: "ya tengo", tool_calls: theToolCall }), toolMsg, usr],
  };
  const out = normalizePayload(payload);
  assert.equal(out, undefined, "no rewrite needed; idempotent");
  assert.equal(payload.messages[2].reasoning_content, "ya tengo", "existing content preserved");
});

test("normalizePayload is deterministic: same input -> identical serialized output", () => {
  const mk = () =>
    JSON.parse(
      JSON.stringify({
        model: "m",
        messages: [
          usr,
          asst({ reasoning_details: [{ type: "reasoning.text", text: "abc", index: 0 }] }),
          toolMsg,
        ],
      })
    );
  const a = normalizePayload(mk());
  const b = normalizePayload(mk());
  assert.equal(JSON.stringify(a), JSON.stringify(b), "stable across runs");
});

test("historyHasToolCalls detects a prior tool call", () => {
  assert.equal(historyHasToolCalls([usr, asst({ tool_calls: theToolCall })]), true);
  assert.equal(historyHasToolCalls([usr, asst({})]), false);
  assert.equal(historyHasToolCalls([usr, asst({ tool_calls: [] })]), false);
});

test("hasReasoningResidue", () => {
  assert.equal(hasReasoningResidue(asst({ reasoning_details: [] })), true);
  assert.equal(hasReasoningResidue(asst({ reasoning: "x" })), true);
  assert.equal(hasReasoningResidue(asst({})), false);
  assert.equal(hasReasoningResidue(undefined), false);
});
