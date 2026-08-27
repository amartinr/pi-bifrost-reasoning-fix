// verify-fix.mjs
//
// Regression check against a live Bifrost endpoint. Reproduces the DeepSeek
// reasoning-drop on tool-calling turns and confirms the payload normalization
// of this extension restores reasoning.
//
// Usage:
//   BIFROST_BASE_URL=<gateway-base>/v1 \
//   BIFROST_API_KEY=sk-... \
//   node scripts/verify-fix.mjs
//
// Env:
//   BIFROST_BASE_URL  (required, e.g. http://<bifrost-host>/v1)
//   BIFROST_API_KEY   (required)
//   BIFROST_MODEL     (default deepseek/deepseek-v4-flash)

// --- mirror of src/index.ts normalization (kept dependency-free) ---
const REASONING_TEXT_TYPE = "reasoning.text";

function extractReasoningText(details) {
	if (!Array.isArray(details)) return "";
	let out = "";
	for (const item of details) {
		if (
			item &&
			typeof item === "object" &&
			item.type === REASONING_TEXT_TYPE &&
			typeof item.text === "string"
		) {
			out += item.text;
		}
	}
	return out;
}

function hasReasoningResidue(msg) {
	return !!(
		msg &&
		(Array.isArray(msg.reasoning_details) ||
			typeof msg.reasoning === "string")
	);
}

function normalizeAssistant(msg) {
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

// Detect tool-calling from *history content* (a prior assistant carried
// tool_calls) as well as from `tools` in this request. DeepSeek drops reasoning
// when a tool-calling history is replayed without `reasoning_content` on every
// assistant, even when `tools` is absent from the current payload.
function fixInlet(payload) {
	if (!payload || !Array.isArray(payload.messages)) return payload;
	let touched = false;
	for (const msg of payload.messages) {
		if (!msg || msg.role !== "assistant") continue;
		if (hasReasoningResidue(msg)) {
			normalizeAssistant(msg);
			touched = true;
		}
	}
	const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
	const historyHasToolCalls = payload.messages.some(
		(m) =>
			m && m.role === "assistant" &&
			Array.isArray(m.tool_calls) && m.tool_calls.length > 0
	);
	if (hasTools || historyHasToolCalls) {
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
// --- end mirror ---

const BASE = process.env.BIFROST_BASE_URL;
const KEY = process.env.BIFROST_API_KEY;
const MODEL = process.env.BIFROST_MODEL ?? "deepseek/deepseek-v4-flash";

if (!BASE || !KEY) {
	console.error("BIFROST_BASE_URL and BIFROST_API_KEY are required");
	process.exit(1);
}

function toolPayload() {
	return [
		{
			type: "function",
			function: {
				name: "bash",
				description: "run a shell command",
				parameters: {
					type: "object",
					properties: { command: { type: "string" } },
					required: ["command"],
				},
			},
		},
	];
}

// History with a tool call; the assistant carries Bifrost reasoning_details
// (as pi would forward it without this fix).
function history({ fixed }) {
	const assistant = {
		role: "assistant",
		content: "voy a listar",
		tool_calls: [
			{
				id: "c1",
				type: "function",
				function: { name: "bash", arguments: '{"command":"ls"}' },
			},
		],
	};
	if (fixed) {
		assistant.reasoning_content = "debo llamar bash para listar";
	} else {
		assistant.reasoning_details = [
			{ type: "reasoning.text", text: "debo llamar bash para listar", index: 0 },
		];
	}
	return [
		{ role: "system", content: "agente" },
		{ role: "user", content: "haz ls" },
		assistant,
		{ role: "tool", tool_call_id: "c1", name: "bash", content: "proc.c" },
		{ role: "user", content: "vale, y ahora razona paso a paso: cuanto es 45*13?" },
	];
}

async function countReasoning(payload) {
	const resp = await fetch(`${BASE}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ stream: true, ...payload }),
	});
	const status = resp.status;
	const text = await resp.text();
	let reasoning = 0;
	for (const line of text.split("\n")) {
		const s = line.trim();
		if (!s.startsWith("data:") || s === "data: [DONE]") continue;
		try {
			const ev = JSON.parse(s.slice(5).trim());
			const delta = ev?.choices?.[0]?.delta;
			if (delta && typeof delta.reasoning === "string" && delta.reasoning) {
				reasoning++;
			}
		} catch {
			/* non-JSON keep-alive */
		}
	}
	return { status, reasoning };
}

const basePayload = {
	model: MODEL,
	tools: toolPayload(),
	thinking: { type: "enabled" },
	reasoning_effort: "high",
};

const broken = {
	...basePayload,
	messages: history({ fixed: false }),
};
const fixed = fixInlet({
	...basePayload,
	messages: structuredClone(broken.messages),
});

// pi often re-sends history after a tool call WITHOUT `tools` in the payload.
// DeepSeek still drops reasoning in that case unless every assistant carries
// `reasoning_content`. This is the exact regression reported: first turn
// reasons, but reasoning stops once a tool call is in the history.
const noToolsFixed = fixInlet({
	model: MODEL,
	thinking: { type: "enabled" },
	reasoning_effort: "high",
	messages: structuredClone(broken.messages),
});

console.log(`== ${MODEL} @ ${BASE} ==`);
for (const [label, payload, expectReasoning] of [
	["without-fix (reasoning_details)", broken, 0],
	["with-fix (reasoning_content)", fixed, 1],
	["with-fix, tools absent in payload (regression case)", noToolsFixed, 1],
]) {
	const { status, reasoning } = await countReasoning(payload);
	const ok =
		status === 200 &&
		(expectReasoning === 0 ? reasoning === 0 : reasoning > 0);
	console.log(
		`[${ok ? "PASS" : "FAIL"}] ${label}: status=${status} reasoning_chunks=${reasoning}`
	);
}
