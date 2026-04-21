/**
 * Minimal SeriousLetter external-API client for Jobs MCP.
 *
 * Jobs MCP writes to SL via its token-gated /api/v1/* endpoints. This client
 * covers the small surface that Jobs MCP needs today; it deliberately does
 * not duplicate the full SL-MCP api-client.
 *
 * Config via env:
 *   SL_API_URL   — e.g. https://jobs.seriousletter.com (no trailing slash)
 *   SL_API_TOKEN — raw token (hashed server-side, SHA-256)
 *
 * If SL_API_URL is unset, we default to the public prod host; SL_API_TOKEN
 * has no default and must be provided for any authenticated call.
 */

const DEFAULT_BASE = "https://jobs.seriousletter.com";

function base(): string {
  const raw = process.env.SL_API_URL ?? DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function token(): string {
  const t = process.env.SL_API_TOKEN;
  if (!t) {
    throw new Error(
      "SL_API_TOKEN is not set. Configure it in ~/.claude.json under mcpServers.jobs.env.",
    );
  }
  return t;
}

export async function slRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${base()}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "X-API-Token": token(),
      Accept: "application/json",
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  };
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SL API ${method} ${path}: HTTP ${response.status} — ${text}`);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** GET /api/v1/jobs/{uuid} */
export async function getJob(uuid: string): Promise<Record<string, unknown>> {
  return slRequest<Record<string, unknown>>("GET", `/api/v1/jobs/${uuid}`);
}

/** GET /api/v1/profiles/{uuid} — full CV content. */
export async function getProfile(uuid: string): Promise<Record<string, unknown>> {
  return slRequest<Record<string, unknown>>("GET", `/api/v1/profiles/${uuid}`);
}

/** GET /api/v1/profiles — list profiles for the active user. */
export async function listProfiles(): Promise<Record<string, unknown>> {
  return slRequest<Record<string, unknown>>("GET", `/api/v1/profiles`);
}

/** POST /api/v1/jobs/{uuid}/notes — attach a note to a job. */
export async function addNote(
  jobUuid: string,
  text: string,
  category?: string,
): Promise<Record<string, unknown>> {
  return slRequest<Record<string, unknown>>("POST", `/api/v1/jobs/${jobUuid}/notes`, {
    text,
    category: category ?? "ai-evaluation",
  });
}
