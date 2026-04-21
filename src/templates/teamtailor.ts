/**
 * Teamtailor job-listing template (HTTP + schema.org JobPosting JSON-LD).
 *
 * Teamtailor server-renders every job-detail page and reliably embeds
 * one `<script type="application/ld+json">` block whose `@type` is
 * `JobPosting`. Extraction is deterministic once that block is parsed.
 *
 * URL shape: `https://{company}.teamtailor.com/jobs/{id}-{slug}`
 *
 * JSON-LD fields we rely on (confirmed 2026-04-21 against Spotify):
 *   - title                               → job title
 *   - description                         → JD (HTML-entity-encoded)
 *   - hiringOrganization.name             → company
 *   - jobLocation.address.addressLocality → location
 *
 * og:description is kept as fallback for the rare case where
 * JSON-LD parsing fails (malformed JSON from a customer page).
 */

import type { HttpTemplate } from "./types.js";

export const teamtailorTemplate: HttpTemplate = {
  name: "Teamtailor",
  urlPattern: /\.teamtailor\.com\/jobs\/[^/?#]+/,
  method: "http",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
  fields: {
    title: { jsonLdPath: "title" },
    company: { jsonLdPath: "hiringOrganization.name" },
    location: { jsonLdPath: "jobLocation.address.addressLocality" },
    description: { jsonLdPath: "description" },
    descriptionFallback: { metaTag: "og:description" },
    employmentType: { jsonLdPath: "employmentType" },
    datePosted: { jsonLdPath: "datePosted" },
  },
};
