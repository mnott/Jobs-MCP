/**
 * Greenhouse job-listing template (API method).
 *
 * Public URL shapes supported:
 *   https://boards.greenhouse.io/{company}/jobs/{jobId}
 *   https://job-boards.greenhouse.io/{company}/jobs/{jobId}
 *   https://job-boards.eu.greenhouse.io/{company}/jobs/{jobId}
 *
 * Individual-job API:
 *   https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{jobId}
 *
 * The JSON has:
 *   title
 *   company_name          → company
 *   location.name         → location
 *   content               → HTML JD (stripped by extractor)
 *   absolute_url          → canonical URL
 *   first_published       → datePosted
 *   language              → language
 *   departments[].name    → team
 *
 * Confirmed 2026-04-21 against boards-api.greenhouse.io/v1/boards/airbnb.
 */

import type { ApiTemplate, ScrapedJob } from "./types.js";

const URL_RE =
  /^https?:\/\/(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i;

type GreenhousePayload = {
  title?: string;
  company_name?: string;
  location?: { name?: string };
  content?: string; // HTML, entity-encoded
  absolute_url?: string;
  first_published?: string;
  language?: string;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
};

function apiUrl(publicUrl: string): string {
  const m = publicUrl.match(URL_RE);
  if (!m) throw new Error(`Unexpected Greenhouse URL: ${publicUrl}`);
  const [, company, jobId] = m;
  return `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function apiExtract(json: unknown): Partial<ScrapedJob> {
  const j = (json ?? {}) as GreenhousePayload;
  const rawContent = j.content ?? "";
  const description = rawContent ? stripHtml(decodeHtmlEntities(rawContent)) : "";

  const extra: Record<string, string> = {};
  if (j.first_published) extra.postedOn = j.first_published;
  if (j.language) extra.language = j.language;
  if (j.departments?.[0]?.name) extra.team = j.departments[0].name;
  if (j.absolute_url) extra.canonicalUrl = j.absolute_url;

  return {
    title: j.title ?? "",
    company: j.company_name ?? "",
    location: j.location?.name ?? j.offices?.[0]?.name ?? "",
    description,
    extra,
  };
}

export const greenhouseTemplate: ApiTemplate = {
  name: "Greenhouse",
  urlPattern: URL_RE,
  method: "api",
  fields: {},
  apiUrl,
  apiExtract,
};
