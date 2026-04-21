#!/usr/bin/env node
/**
 * Jobs MCP server — entry point and tool registrations.
 *
 * Workflow-layer MCP for job search: scraping, liveness, link unwrap.
 * Persists results to SeriousLetter via its external API (not in this
 * file yet — phase 1 is stateless operations only).
 *
 * stdout is the JSON-RPC transport — all debug output goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { scrapeJob, listTemplates } from "./scraper.js";
import { classifyLiveness } from "./liveness/classify.js";
import { unwrapSync, unwrapAsync } from "./unwrap/index.js";
import * as orp from "./orp/client.js";
import * as orpSearch from "./orp/search.js";
import * as sl from "./sl/client.js";
import { evaluate as evaluateAG } from "./evaluator/aG.js";

function textResponse(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

const server = new McpServer(
  {
    name: "jobs",
    version: "0.1.0",
  },
  {
    instructions: [
      "## Jobs MCP — Job-Search Workflow Tools",
      "",
      "Workflow-layer tools for job discovery and evaluation. Persists to",
      "SeriousLetter via its external API (future phase).",
      "",
      "### Available Tools",
      "",
      "| Tool | Purpose |",
      "|------|---------|",
      "| `jm_scrape` | Scrape a job URL → structured data + liveness verdict. |",
      "| `jm_liveness` | Classify a URL or supplied HTML as active / expired / uncertain. |",
      "| `jm_unwrap` | Unwrap a tracker URL (Google Alerts / LinkedIn /comm/ / Experteer) to the real JD URL. |",
      "| `jm_list_templates` | List registered scraping templates. |",
      "| `jm_orp_check_session` | Check job-room.ch (Swiss RAV/ORP) browser session. |",
      "| `jm_orp_list_efforts` | List proof records (Arbeitsbemühungen). |",
      "| `jm_orp_get_proof` | Get a single proof record. |",
      "| `jm_orp_submit_effort` | Submit a work effort. |",
      "| `jm_orp_sync_job` | Copy an SL job → job-room.ch work effort. |",
      "| `jm_orp_search` | Search job-room.ch public job ads (no auth). |",
      "| `jm_orp_get_jobroom_job` | Fetch a single job-room.ch ad (no auth). |",
      "| `jm_evaluate` | Run the A-G evaluator (B/E/G) on an SL job using the active CV. |",
      "",
      "### Typical Flow",
      "",
      "1. `jm_unwrap` the link from an email alert → real JD URL.",
      "2. `jm_scrape` the cleaned URL → structured job data + liveness verdict.",
      "3. If verdict == `expired`, skip this job. If `active`, proceed.",
      "4. Persist via SL MCP (`sl_create_job`) in the agent's normal flow.",
      "",
      "### Templates",
      "",
      "- **LinkedIn** (HTTP) — full JD via `show-more-less-html__markup`, no browser.",
      "- **Teamtailor** (HTTP) — schema.org JobPosting JSON-LD.",
      "- **Glassdoor** (Playwright) — only if the optional `playwright` dep is installed.",
      "- **Workday** (API) — `/wday/cxs/` JSON endpoint.",
      "- **Lever** (API) — `api.lever.co/v0/postings/{co}/{id}?mode=json`.",
      "- **Greenhouse** (API) — `boards-api.greenhouse.io/v1/boards/{co}/jobs/{id}`.",
      "- **Ashby** (API) — company board + UUID filter.",
      "",
      "Taleo, Avature, SmartRecruiters, SuccessFactors, JobUp, BambooHR land next.",
    ].join("\n"),
  },
);

server.tool(
  "jm_list_templates",
  "List registered scraping templates and their URL patterns.",
  {},
  async () => textResponse({ templates: listTemplates() }),
);

server.tool(
  "jm_unwrap",
  "Unwrap a tracker/redirect URL to its real job-description target. Handles Google Alerts (google.com/url?q=), LinkedIn /comm/jobs/view, Experteer link.experteer.ch/c/, and generic UTM-param stripping. Returns original URL, unwrapped URL, and the unwrap kind.",
  {
    url: z.string().url().describe("The tracker URL from an email alert or similar"),
    follow_redirects: z
      .boolean()
      .default(false)
      .describe("Also do an HTTP HEAD to resolve server-side redirects (Experteer, Indeed cts.)"),
  },
  async ({ url, follow_redirects }) => {
    try {
      const result = follow_redirects ? await unwrapAsync(url) : unwrapSync(url);
      return textResponse(result);
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_liveness",
  "Classify whether a job posting is still accepting applications. Returns active / expired / uncertain + reason. If only `url` is provided, fetches the page; or pass `body` + optional `status` directly to classify without a fetch.",
  {
    url: z.string().url().describe("The job posting URL"),
    body: z.string().optional().describe("HTML body, if already fetched (skips network)"),
    status: z.number().int().optional().describe("HTTP status code, if known"),
  },
  async ({ url, body, status }) => {
    try {
      let effectiveBody = body;
      let effectiveStatus = status;
      if (!effectiveBody) {
        const resp = await fetch(url, { redirect: "follow" });
        effectiveStatus = resp.status;
        effectiveBody = await resp.text();
      }
      const result = classifyLiveness({ url, body: effectiveBody, status: effectiveStatus });
      return textResponse(result);
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// =====================================================================
// job-room.ch (ORP / NPA) tools — browser-proxy + public search
//
// Auth-required tools (list/get/submit/sync) proxy through Chrome via
// macOS AppleScript because job-room.ch's session uses httpOnly cookies
// from idp.arbeit.swiss SSO that can't be replicated externally.
// Public-search tools (jm_orp_search / jm_orp_get_jobroom_job) do not
// require a Chrome session — they hit the open Angular backend.
// =====================================================================

server.tool(
  "jm_orp_check_session",
  "Check whether Chrome has an active job-room.ch session. Returns userId + user info if authenticated.",
  {},
  async () => {
    try {
      const session = await orp.checkSession();
      if (!session.ok) {
        return textResponse({
          authenticated: false,
          message: session.error || "Not logged in. Please open job-room.ch in Chrome and log in.",
        });
      }
      return textResponse({
        authenticated: true,
        userId: session.userId,
        user: session.user,
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_list_efforts",
  "List the logged-in user's proof-of-job-search records (Arbeitsbemühungen) on job-room.ch. Each record contains work efforts for one control period.",
  {
    page: z.number().int().optional().describe("Page number (default 0)"),
  },
  async ({ page }) => {
    try {
      return textResponse(await orp.listProofs(undefined, page));
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_get_proof",
  "Get a single job-room.ch proof record with all of its work efforts. Use jm_orp_list_efforts first to discover the proof_id.",
  {
    proof_id: z.string().describe("UUID of the proof record"),
  },
  async ({ proof_id }) => {
    try {
      return textResponse(await orp.getProof(proof_id));
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_submit_effort",
  "Submit a new work effort (Arbeitsbemühung) to job-room.ch. Requires an active Chrome session on job-room.ch.",
  {
    occupation: z.string().describe("Position title"),
    apply_date: z.string().describe("YYYY-MM-DD"),
    company_name: z.string(),
    company_street: z.string().optional(),
    company_house_number: z.string().optional(),
    company_postal_code: z.string().optional(),
    company_city: z.string().optional(),
    company_country: z.string().optional().describe("ISO country code (default CH)"),
    contact_person: z.string().optional(),
    email: z.string().optional(),
    form_url: z.string().optional(),
    phone: z.string().optional(),
    apply_channel: z
      .enum(["ELECTRONIC", "MAIL", "PERSONAL", "PHONE"])
      .optional()
      .describe("How the application was sent (default ELECTRONIC)"),
    apply_status: z
      .enum(["PENDING", "EMPLOYED", "REJECTED", "INTERVIEW"])
      .optional()
      .describe("Effort status (default PENDING)"),
    full_time: z.boolean().optional(),
  },
  async (params) => {
    try {
      const data: orp.CreateWorkEffortData = {
        occupation: params.occupation,
        applyDate: params.apply_date,
        companyName: params.company_name,
        companyStreet: params.company_street,
        companyHouseNumber: params.company_house_number,
        companyPostalCode: params.company_postal_code,
        companyCity: params.company_city,
        companyCountry: params.company_country || "CH",
        contactPerson: params.contact_person,
        email: params.email,
        formUrl: params.form_url,
        phone: params.phone,
        applyChannelTypes: [params.apply_channel || "ELECTRONIC"],
        applyStatus: [params.apply_status || "PENDING"],
        fullTimeJob: params.full_time !== false,
      };
      const result = await orp.createWorkEffort(data);
      return textResponse({
        message: `Submitted "${params.occupation}" at ${params.company_name} to job-room.ch.`,
        result,
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_sync_job",
  "Fetch a SeriousLetter job by UUID (via the SL external API), map its fields to job-room.ch work-effort shape, and submit it. Requires SL_API_TOKEN env + an active Chrome job-room.ch session.",
  {
    job_uuid: z.string().describe("UUID of the SeriousLetter job to sync"),
    apply_date: z.string().optional().describe("Override apply date YYYY-MM-DD (defaults to job's applied_date or today)"),
  },
  async ({ job_uuid, apply_date }) => {
    try {
      const job = await sl.getJob(job_uuid);
      const data = orp.slJobToWorkEffort(job, apply_date);
      if (!data.companyName || !data.occupation) {
        return errorResponse(
          new Error(
            `Job ${job_uuid} missing required fields. company="${data.companyName}", title="${data.occupation}"`,
          ),
        );
      }
      const result = await orp.createWorkEffort(data);
      return textResponse({
        message: `Synced "${data.occupation}" at ${data.companyName} to job-room.ch.`,
        mapped: data,
        result,
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_search",
  "Search job-room.ch public job-ad API (no auth required). Filters include keywords, Swiss canton codes, company, workload %, etc.",
  {
    keywords: z.array(z.string()).optional(),
    canton_codes: z
      .array(z.string())
      .optional()
      .describe("2-letter canton codes (e.g., ZH, VD, VS)"),
    company_name: z.string().optional(),
    workload_min: z.number().int().optional().describe("Minimum workload %"),
    workload_max: z.number().int().optional().describe("Maximum workload %"),
    permanent: z.boolean().optional(),
    online_since: z.number().int().optional().describe("Days since posted"),
    language: z.string().optional().describe("ISO language code (de/fr/it/en)"),
    page: z.number().int().optional(),
    size: z.number().int().optional(),
  },
  async (params) => {
    try {
      const result = await orpSearch.searchJobs(
        {
          keywords: params.keywords,
          cantonCodes: params.canton_codes,
          companyName: params.company_name,
          workloadPercentageMin: params.workload_min,
          workloadPercentageMax: params.workload_max,
          permanent: params.permanent,
          onlineSince: params.online_since,
          language: params.language,
        },
        params.page ?? 0,
        params.size ?? 20,
      );
      return textResponse(result);
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_orp_get_jobroom_job",
  "Get full details of a job-room.ch job ad by its UUID. No auth required.",
  {
    job_id: z.string().describe("job-room.ch job-ad UUID"),
  },
  async ({ job_id }) => {
    try {
      return textResponse(await orpSearch.getJob(job_id));
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// =====================================================================
// A-G evaluator (phase-1 slice: blocks B / E / G)
//
// Needs ANTHROPIC_API_KEY + SL_API_TOKEN in the MCP env. Single Anthropic
// call per evaluation (Opus 4.7). If `save_to_sl=true`, the result is
// POSTed as a note on the SL job.
// =====================================================================

server.tool(
  "jm_evaluate",
  "Evaluate an SL job against the active user's base CV. Produces blocks B (CV match), E (personalization plan), and G (posting legitimacy). Requires ANTHROPIC_API_KEY + SL_API_TOKEN in env. Cost: one Opus 4.7 call per run.",
  {
    job_uuid: z.string().describe("UUID of the SeriousLetter job to evaluate"),
    profile_uuid: z
      .string()
      .optional()
      .describe("UUID of the base CV profile to use (defaults to the first is_base profile)"),
    blocks: z
      .array(z.enum(["B", "E", "G"]))
      .optional()
      .describe("Which blocks to produce (default: B, E, G)"),
    save_to_sl: z
      .boolean()
      .optional()
      .describe("If true, attach the evaluation as a note on the job (default false)"),
  },
  async ({ job_uuid, profile_uuid, blocks, save_to_sl }) => {
    try {
      const job = await sl.getJob(job_uuid);

      // Resolve profile
      let profile: Record<string, unknown>;
      if (profile_uuid) {
        profile = await sl.getProfile(profile_uuid);
      } else {
        const list = (await sl.listProfiles()) as { profiles?: Array<Record<string, unknown>> };
        const items = list.profiles ?? [];
        const base =
          items.find((p) => p.is_base === true) ?? items[0];
        if (!base || !base.uuid) {
          return errorResponse(
            new Error("No CV profile found for the active SL user. Provide profile_uuid explicitly."),
          );
        }
        profile = await sl.getProfile(base.uuid as string);
      }

      const result = await evaluateAG({ job, profile, focusBlocks: blocks });

      let note: Record<string, unknown> | undefined;
      if (save_to_sl) {
        note = await sl.addNote(
          job_uuid,
          `# AI Evaluation (Jobs MCP — blocks ${result.blocks.join(", ")})\n\n${result.markdown}`,
          "ai-evaluation",
        );
      }

      return textResponse({
        model: result.model,
        blocks: result.blocks,
        usage: result.usage,
        saved: save_to_sl ? note : undefined,
        markdown: result.markdown,
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "jm_scrape",
  "Scrape a job URL using the matching site template. Returns structured job data (title, company, location, description) plus a liveness verdict (active/expired/uncertain). Templates available: see `jm_list_templates`.",
  {
    url: z.string().url().describe("The job posting URL"),
  },
  async ({ url }) => {
    try {
      const { job, rawHtml, status } = await scrapeJob(url);
      // Classify liveness against the full HTML so apply buttons / gating attributes are visible,
      // with a fallback to the extracted description if the HTML came up empty.
      const liveness = classifyLiveness({
        url,
        body: rawHtml || job.description || "",
        status,
      });
      return textResponse({ ...job, liveness });
    } catch (err) {
      return errorResponse(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Debug to stderr only — stdout is the JSON-RPC channel
  process.stderr.write("jobs-mcp v0.1.0 started (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`jobs-mcp fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
