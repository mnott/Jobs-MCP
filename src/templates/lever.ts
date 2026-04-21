/**
 * Lever job-listing template (API method).
 *
 * Public URL: https://jobs.lever.co/{company}/{jobId}
 * Individual-job API:
 *   https://api.lever.co/v0/postings/{company}/{jobId}?mode=json
 *
 * The JSON has:
 *   text             → title
 *   descriptionPlain → plaintext JD (preferred; already stripped)
 *   description      → HTML JD (fallback)
 *   categories       → { location, team, commitment, allLocations }
 *   hostedUrl        → canonical URL
 *
 * Confirmed 2026-04-21 against jobs.lever.co/palantir.
 */

import type { ApiTemplate, ScrapedJob } from "./types.js";

const URL_RE = /^https?:\/\/jobs\.lever\.co\/([^/?#]+)\/([^/?#]+)/i;

type LeverPayload = {
  text?: string;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  additional?: string;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    allLocations?: string[];
  };
  hostedUrl?: string;
  createdAt?: number;
  workplaceType?: string;
};

function apiUrl(publicUrl: string): string {
  const m = publicUrl.match(URL_RE);
  if (!m) throw new Error(`Unexpected Lever URL: ${publicUrl}`);
  const [, company, jobId] = m;
  return `https://api.lever.co/v0/postings/${company}/${jobId}?mode=json`;
}

function apiExtract(json: unknown, url: string): Partial<ScrapedJob> {
  const j = (json ?? {}) as LeverPayload;
  const cats = j.categories ?? {};
  const m = url.match(URL_RE);
  const company = m ? m[1] : "";

  // Prefer descriptionPlain; concat additionalPlain if present.
  const parts: string[] = [];
  if (j.descriptionPlain) parts.push(j.descriptionPlain.trim());
  if (j.additionalPlain) parts.push(j.additionalPlain.trim());
  const description = parts.filter(Boolean).join("\n\n");

  const extra: Record<string, string> = {};
  if (cats.team) extra.team = cats.team;
  if (cats.commitment) extra.employmentType = cats.commitment;
  if (j.workplaceType) extra.workplaceType = j.workplaceType;
  if (j.createdAt) extra.postedOn = new Date(j.createdAt).toISOString();

  return {
    title: j.text ?? "",
    company,
    location: cats.location ?? cats.allLocations?.[0] ?? "",
    description,
    extra,
  };
}

export const leverTemplate: ApiTemplate = {
  name: "Lever",
  urlPattern: URL_RE,
  method: "api",
  fields: {},
  apiUrl,
  apiExtract,
};
