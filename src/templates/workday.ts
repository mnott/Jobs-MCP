/**
 * Workday job-listing template (API method).
 *
 * Public URL pattern:
 *   https://{tenant}.{shard}.myworkdayjobs.com/[{lang}/]{site}/job/{location}/{slug}_{jobId}
 * Internal JSON API for the same job:
 *   https://{tenant}.{shard}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{location}/{slug}_{jobId}
 *
 * The JSON response has:
 *   jobPostingInfo: { title, jobDescription (HTML), location, canApply, posted, externalUrl, ... }
 *   hiringOrganization: { name }
 *
 * Confirmed 2026-04-21 against nvidia.wd5.myworkdayjobs.com.
 *
 * Note: `hiringOrganization.name` is often the internal org name
 * (e.g. "2100 NVIDIA USA"). We keep it as-is because cleaner names
 * live in the URL slug anyway.
 */

import type { ApiTemplate, ScrapedJob } from "./types.js";

// Strip the language segment Workday injects in some tenants (e.g., `/en-US/`).
const LANG_SEGMENT = /^[a-z]{2}(?:[-_][A-Z]{2})?$/;

/**
 * Turn a public Workday URL into its /wday/cxs/ JSON sibling.
 *
 * Handles URLs with and without a language prefix:
 *   /Careers/job/...                    → /wday/cxs/{tenant}/Careers/job/...
 *   /en-US/Careers/job/...              → /wday/cxs/{tenant}/Careers/job/...
 */
function apiUrl(publicUrl: string): string {
  const u = new URL(publicUrl);
  // Hostname: {tenant}.{shard}.myworkdayjobs.com
  const tenant = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  // Drop optional leading language segment
  if (parts[0] && LANG_SEGMENT.test(parts[0])) parts.shift();
  // parts = [site, "job", ...rest]
  if (parts.length < 2 || parts[1] !== "job") {
    throw new Error(`Unexpected Workday path: ${u.pathname}`);
  }
  const site = parts[0];
  const rest = parts.slice(1).join("/"); // "job/.../slug_jobId"
  return `${u.origin}/wday/cxs/${tenant}/${site}/${rest}`;
}

type WdPayload = {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    canApply?: boolean;
    posted?: boolean;
    timeType?: string;
    postedOn?: string;
    externalUrl?: string;
    jobReqId?: string;
  };
  hiringOrganization?: { name?: string };
};

function apiExtract(json: unknown, url: string): Partial<ScrapedJob> {
  const payload = (json ?? {}) as WdPayload;
  const info = payload.jobPostingInfo ?? {};
  const extra: Record<string, string> = {};
  if (info.timeType) extra.employmentType = info.timeType;
  if (info.postedOn) extra.postedOn = info.postedOn;
  if (typeof info.canApply === "boolean") extra.canApply = String(info.canApply);
  if (typeof info.posted === "boolean") extra.posted = String(info.posted);
  if (info.jobReqId) extra.jobReqId = info.jobReqId;

  // jobDescription is HTML — keep it here; scrapeApi doesn't run stripHtmlTags.
  // Run a minimal strip inline.
  let description = info.jobDescription ?? "";
  description = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title: info.title ?? "",
    company: payload.hiringOrganization?.name ?? "",
    location: info.location ?? "",
    description,
    extra,
  };
}

export const workdayTemplate: ApiTemplate = {
  name: "Workday",
  urlPattern: /\.myworkdayjobs\.com\/.+\/job\//,
  method: "api",
  fields: {},
  apiUrl,
  apiExtract,
  fetchInit: () => ({
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  }),
};
