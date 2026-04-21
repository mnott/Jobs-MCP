/**
 * Ashby job-listing template (API method via list-and-filter).
 *
 * Public URL: https://jobs.ashbyhq.com/{company}/{jobIdUUID}[optional-trailing]
 *
 * Ashby's individual-job endpoint is 401 for unauthenticated GETs. The
 * company-wide list endpoint is open:
 *   https://api.ashbyhq.com/posting-api/job-board/{company}?includeCompensation=true
 *
 * Strategy: fetch the full job board, filter to the matching UUID.
 * Wasteful for very large boards (Perplexity returned 621 KB), but
 * still cheap — one fetch, pure JSON, no AI.
 *
 * Per-job fields we rely on:
 *   title, location, team, employmentType, publishedAt, workplaceType,
 *   descriptionPlain / descriptionHtml, jobUrl, applyUrl, compensation.
 *
 * Confirmed 2026-04-21 against jobs.ashbyhq.com/perplexity.
 */

import type { ApiTemplate, ScrapedJob } from "./types.js";

const URL_RE = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/i;
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  team?: string;
  department?: string;
  employmentType?: string;
  workplaceType?: string;
  publishedAt?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
  isRemote?: boolean;
};

type AshbyBoard = { jobs?: AshbyJob[]; apiVersion?: string };

function parseUrl(publicUrl: string): { company: string; jobId: string } {
  const m = publicUrl.match(URL_RE);
  if (!m) throw new Error(`Unexpected Ashby URL: ${publicUrl}`);
  const company = m[1];
  // jobId may be a bare UUID or UUID+slug — prefer UUID if present.
  const uu = m[2].match(UUID_RE);
  const jobId = uu ? uu[1] : m[2];
  return { company, jobId };
}

function apiUrl(publicUrl: string): string {
  const { company } = parseUrl(publicUrl);
  return `https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=true`;
}

function apiExtract(json: unknown, url: string): Partial<ScrapedJob> {
  const { company, jobId } = parseUrl(url);
  const board = (json ?? {}) as AshbyBoard;
  const jobs = board.jobs ?? [];
  const match = jobs.find((j) => j.id === jobId);
  if (!match) {
    return {
      title: "",
      company,
      location: "",
      description: "",
      extra: { error: `Ashby: job ${jobId} not found in current board (${jobs.length} jobs listed). Posting may be closed.` },
    };
  }
  const extra: Record<string, string> = {};
  if (match.team) extra.team = match.team;
  if (match.department) extra.department = match.department;
  if (match.employmentType) extra.employmentType = match.employmentType;
  if (match.workplaceType) extra.workplaceType = match.workplaceType;
  if (match.publishedAt) extra.postedOn = match.publishedAt;
  if (typeof match.isRemote === "boolean") extra.isRemote = String(match.isRemote);
  if (match.applyUrl) extra.applyUrl = match.applyUrl;

  const secondary = match.secondaryLocations?.map((s) => s.location).filter(Boolean).join(", ");
  const location = [match.location, secondary].filter(Boolean).join(" / ");

  return {
    title: match.title ?? "",
    company,
    location,
    description: match.descriptionPlain ?? "",
    extra,
  };
}

export const ashbyTemplate: ApiTemplate = {
  name: "Ashby",
  urlPattern: URL_RE,
  method: "api",
  fields: {},
  apiUrl,
  apiExtract,
};
