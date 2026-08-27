import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the home directory in a robust way.
 * Prioritizes PI_CODING_AGENT_DIR (if it points to an agent directory),
 * then HOME, and finally homedir() as a last resort.
 */
function resolveHomeDir(): string {
  // PI_CODING_AGENT_DIR might be the full agent directory
  const piDir = process.env.PI_CODING_AGENT_DIR;
  if (piDir) {
    // Strip trailing "/agent" or "\agent" (cross-platform)
    const base = piDir.replace(/[/\\]agent$/, "");
    // Expand ~ to actual home directory (handles both ~/ and ~\)
    if (base.startsWith("~/") || base.startsWith("~\\")) {
      return join(homedir(), base.slice(2));
    }
    return base;
  }
  // Fallback: HOME env var or homedir()
  const hd = homedir();
  if (process.env.HOME) {
    return process.env.HOME;
  }
  if (hd) {
    return hd;
  }
  return "/";
}

const CONFIG_PATH = join(
  resolveHomeDir(),
  ".pi",
  "agent",
  "extensions",
  "pi-bifrost-reasoning-fix",
  "config.json"
);

export interface Config {
  /** Model IDs routed through Bifrost to which the fix applies. */
  models: string[];
  /**
   * Force an empty `reasoning_content` on every assistant message when the
   * request carries tools. DeepSeek requires the field present even when
   * there is no non-empty reasoning to replay.
   */
  forceReasoningContentOnTools: boolean;
  /** Log level for diagnostics. */
  logLevel: "off" | "error" | "info";
}

export function loadConfig(): Config {
  const defaults: Config = {
    models: [],
    forceReasoningContentOnTools: true,
    logLevel: "off"
  };

  if (!existsSync(CONFIG_PATH)) {
    console.info(
      `Config file not found at ${CONFIG_PATH}. Using default settings.`
    );
    return defaults;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `Failed to parse config file (${CONFIG_PATH}): ${msg}\n` +
      `bf-reasoning-fix will use default settings. Fix the config file or delete it to restore defaults.`
    );
    return defaults;
  }

  const config = { ...defaults, ...(raw as Record<string, unknown>) } as Config;

  try {
    if (!Array.isArray(config.models) || config.models.some((m) => typeof m !== "string")) {
      throw new Error("'models' must be an array of strings");
    }
    if (typeof config.forceReasoningContentOnTools !== "boolean") {
      throw new Error("'forceReasoningContentOnTools' must be a boolean");
    }
    const validLogLevels = ["off", "error", "info"];
    if (!validLogLevels.includes(config.logLevel)) {
      throw new Error("'logLevel' must be one of: 'off', 'error', 'info'");
    }

    return config;
  } catch (err) {
    console.warn(
      `Invalid config values, using defaults: ${err instanceof Error ? err.message : String(err)}`
    );
    return defaults;
  }
}
