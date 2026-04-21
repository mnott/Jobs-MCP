/**
 * A-G job evaluator (phase-1 slice: blocks B, E, G).
 *
 * Given an SL job + a CV profile, ask Claude to produce:
 *   - **Block B — CV Match**: requirement-by-requirement mapping with
 *     quoted CV lines, gap list with hard/soft-blocker tagging, mitigation
 *     hints.
 *   - **Block E — Personalization Plan**: top-5 CV edits + top-3 summary
 *     rewrites tailored to this JD.
 *   - **Block G — Posting Legitimacy**: ghost-job signal triage with
 *     assessment tier (High / Caution / Suspicious) and cited signals.
 *
 * Blocks A/C/D/F (role summary, level strategy, comp research, interview
 * plan) are out of scope for this first pass — they need web research
 * and/or story-bank state the Jobs MCP doesn't yet hold.
 *
 * Model: Claude Opus 4.7 (claude-opus-4-7). Single call, no streaming,
 * no prompt caching. Cost per run is typically ~$0.05-0.15 for a 5 KB JD.
 * The tool wrapper only executes when the user explicitly invokes it.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4096;

export type EvaluateInput = {
  job: Record<string, unknown>;
  profile: Record<string, unknown>;
  focusBlocks?: Array<"B" | "E" | "G">;
};

export type EvaluateResult = {
  model: string;
  blocks: Array<"B" | "E" | "G">;
  markdown: string;
  usage?: Anthropic.Usage;
};

const SYSTEM_PROMPT = `You are a senior career strategist evaluating a job posting against a candidate's CV.

You produce structured markdown with the requested blocks. Use the exact header format "## Block X — <title>" for each. Be specific, cite CV lines with backticks, and distinguish hard blockers from nice-to-haves explicitly.

Rules:
- Quote CV content verbatim when citing evidence.
- Never invent experience the CV doesn't claim.
- Distinguish "not in CV" from "not required".
- For Block G, present observations as signals, not accusations. Use tiers High Confidence / Proceed with Caution / Suspicious only, and justify the tier with cited signals.
- Output only the requested blocks in order. No preamble, no closing remarks.`;

function buildUserMessage(input: EvaluateInput, blocks: Array<"B" | "E" | "G">): string {
  const job = input.job;
  const profile = input.profile;

  const jobBlock = [
    `### Job (SeriousLetter uuid: ${job.uuid ?? "?"})`,
    `- Company: ${job.company ?? "?"}`,
    `- Position: ${job.position_title ?? "?"}`,
    `- Location: ${job.location ?? "?"}`,
    `- Source URL: ${job.source_url ?? "?"}`,
    `- Language: ${job.language ?? "?"}`,
    ``,
    `#### Job description`,
    String(job.job_description ?? "").trim() || "(empty)",
  ].join("\n");

  // Profile is deeply nested; we pass a compact JSON so the model can self-navigate.
  // Strip obvious noise like ids and timestamps.
  const profileCompact = stripNoise(profile);
  const profileBlock = [
    `### Candidate profile (SeriousLetter base CV)`,
    "```json",
    JSON.stringify(profileCompact, null, 2),
    "```",
  ].join("\n");

  const blockDirectives: Record<"B" | "E" | "G", string> = {
    B: [
      `## Block B — CV Match`,
      ``,
      `Produce a markdown table mapping each **explicit requirement in the JD** to a specific CV line. Columns: Requirement | CV evidence (quoted or "(no direct evidence)") | Verdict (Strong / Partial / Gap).`,
      ``,
      `Below the table, list **Gaps** as bullets. For each gap:`,
      `1. Hard blocker or nice-to-have?`,
      `2. Closest adjacent experience (if any).`,
      `3. Mitigation suggestion — one line for the cover letter, or a concrete portfolio proof to add.`,
    ].join("\n"),
    E: [
      `## Block E — Personalization Plan`,
      ``,
      `Top-5 edits to the CV for this specific job, as a markdown table. Columns: # | Section | Current | Proposed change | Rationale.`,
      ``,
      `Below: top-3 summary rewrites, each 2-3 sentences, ready to paste.`,
    ].join("\n"),
    G: [
      `## Block G — Posting Legitimacy`,
      ``,
      `**Assessment:** one of _High Confidence_ / _Proceed with Caution_ / _Suspicious_.`,
      ``,
      `**Signals table** (markdown): Signal | Observation | Weight (Positive / Neutral / Concerning).`,
      ``,
      `**Context notes:** any caveats that explain concerning signals (executive role, niche skill, public-sector timelines, recruiter-sourced, evergreen pipeline, etc.).`,
    ].join("\n"),
  };

  const requested = blocks.map((b) => blockDirectives[b]).join("\n\n");

  return [
    `Evaluate the following job against the candidate profile. Produce the requested blocks in order, no preamble.`,
    ``,
    jobBlock,
    ``,
    profileBlock,
    ``,
    `---`,
    ``,
    `## Requested blocks`,
    ``,
    requested,
  ].join("\n");
}

/** Drop heavy keys that add token cost without evaluator value. */
function stripNoise(profile: Record<string, unknown>): unknown {
  const drop = new Set([
    "id",
    "uuid",
    "user_id",
    "profile_id",
    "created_at",
    "updated_at",
    "is_base",
    "job_id",
    "watermark_id",
  ]);
  function clean(v: unknown): unknown {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(clean);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (drop.has(k)) continue;
      out[k] = clean(val);
    }
    return out;
  }
  return clean(profile);
}

export async function evaluate(input: EvaluateInput): Promise<EvaluateResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to ~/.claude.json under mcpServers.jobs.env to enable jm_evaluate.",
    );
  }
  const blocks = (input.focusBlocks ?? ["B", "E", "G"]).slice().sort() as Array<"B" | "E" | "G">;
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(input, blocks) }],
  });

  const md = response.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    model: response.model,
    blocks,
    markdown: md,
    usage: response.usage,
  };
}
