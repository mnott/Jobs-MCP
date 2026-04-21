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
      "",
      "### Typical Flow",
      "",
      "1. `jm_unwrap` the link from an email alert → real JD URL.",
      "2. `jm_scrape` the cleaned URL → structured job data + liveness verdict.",
      "3. If verdict == `expired`, skip this job. If `active`, proceed.",
      "4. Persist via SL MCP (`sl_create_job`) in the agent's normal flow.",
      "",
      "### Phase 1 scope",
      "",
      "Templates supported: LinkedIn (HTTP). Glassdoor, Taleo, Avature, JobUp,",
      "Workday, Teamtailor, etc. land in phase 2.",
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
