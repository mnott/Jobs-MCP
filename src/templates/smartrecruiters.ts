/**
 * SmartRecruiters job-listing template (API method).
 *
 * Public URL shapes we handle:
 *   https://jobs.smartrecruiters.com/{Company}/{postingId}[-slug]
 *   https://www.smartrecruiters.com/{Company}/{postingId}[-slug]
 * (Customer-branded domains like `careers.{company}.com` are not handled
 * yet — they need per-tenant aliases.)
 *
 * Individual-job API:
 *   https://api.smartrecruiters.com/v1/companies/{Company}/postings/{postingId}
 *
 * The JSON has:
 *   name                                       → title
 *   company.name                               → company
 *   location.city / location.country           → location
 *   jobAd.sections.{companyDescription,
 *                   jobDescription,
 *                   qualifications,
 *                   additionalInformation}.text → description (HTML, concatenated with headers)
 *   postingUrl                                 → canonical URL
 *   applyUrl                                   → apply URL
 *   releasedDate                               → postedOn
 *   active                                     → boolean liveness hint
 *
 * Confirmed 2026-04-21 against api.smartrecruiters.com/v1/companies/Visa.
 */

import type { ApiTemplate, ScrapedJob } from "./types.js";

const URL_RE = /^https?:\/\/(?:jobs|www)\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i;

type SrSection = { title?: string; text?: string };
type SrPayload = {
  name?: string;
  company?: { name?: string };
  location?: { city?: string; country?: string; region?: string; remote?: boolean };
  jobAd?: {
    sections?: Record<string, SrSection>;
  };
  postingUrl?: string;
  applyUrl?: string;
  releasedDate?: string;
  active?: boolean;
  refNumber?: string;
  function?: { label?: string };
  industry?: { label?: string };
};

function parseUrl(publicUrl: string): { company: string; postingId: string } {
  const m = publicUrl.match(URL_RE);
  if (!m) throw new Error(`Unexpected SmartRecruiters URL: ${publicUrl}`);
  return { company: m[1], postingId: m[2] };
}

function apiUrl(publicUrl: string): string {
  const { company, postingId } = parseUrl(publicUrl);
  return `https://api.smartrecruiters.com/v1/companies/${company}/postings/${postingId}`;
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

function apiExtract(json: unknown, url: string): Partial<ScrapedJob> {
  const { company: urlCompany } = parseUrl(url);
  const j = (json ?? {}) as SrPayload;

  const sectionOrder = [
    "companyDescription",
    "jobDescription",
    "qualifications",
    "additionalInformation",
  ];
  const sections = j.jobAd?.sections ?? {};
  const parts: string[] = [];
  for (const key of sectionOrder) {
    const s = sections[key];
    if (!s?.text) continue;
    const heading = s.title ? `## ${s.title}\n\n` : "";
    parts.push(heading + stripHtml(decodeHtmlEntities(s.text)));
  }
  const description = parts.join("\n\n");

  const loc = j.location ?? {};
  const locationParts: string[] = [];
  if (loc.city) locationParts.push(loc.city);
  if (loc.region) locationParts.push(loc.region);
  if (loc.country) locationParts.push(loc.country);
  const location =
    locationParts.join(", ") + (loc.remote ? " (Remote)" : "");

  const extra: Record<string, string> = {};
  if (j.releasedDate) extra.postedOn = j.releasedDate;
  if (typeof j.active === "boolean") extra.active = String(j.active);
  if (j.refNumber) extra.refNumber = j.refNumber;
  if (j.applyUrl) extra.applyUrl = j.applyUrl;
  if (j.postingUrl) extra.canonicalUrl = j.postingUrl;
  if (j.function?.label) extra.function = j.function.label;
  if (j.industry?.label) extra.industry = j.industry.label;

  return {
    title: j.name ?? "",
    company: j.company?.name ?? urlCompany,
    location,
    description,
    extra,
  };
}

export const smartRecruitersTemplate: ApiTemplate = {
  name: "SmartRecruiters",
  urlPattern: URL_RE,
  method: "api",
  fields: {},
  apiUrl,
  apiExtract,
};
