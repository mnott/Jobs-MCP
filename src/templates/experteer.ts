/**
 * Experteer job-listing template (HTTP, teaser-only).
 *
 * Experteer (executive job board, paid membership) gates full JDs
 * behind login. Unauthenticated scrapes get:
 *   - og:title with the role title
 *   - og:description with a ~200-char teaser
 *   - an <h2 title="View {Company}"> with the employer
 *   - "Stellenbeschreibung" heading followed by a short truncated blurb
 *
 * We surface the teaser honestly so downstream agents know this is not
 * a full JD. For evaluation, this is usually enough for Block G (ghost
 * / legitimacy triage); Block B (CV match) needs the user to be logged
 * in — out of scope here.
 *
 * URL shape: https://www.experteer.{ch,de,com,fr,...}/career/view-jobs/{slug}-{id}
 */

import type { HttpTemplate } from "./types.js";

const URL_RE = /^https?:\/\/(?:www\.)?experteer\.[a-z]+\/career\/view-jobs\//i;

export const experteerTemplate: HttpTemplate = {
  name: "Experteer",
  urlPattern: URL_RE,
  method: "http",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,de;q=0.8,fr;q=0.7",
  },
  fields: {
    title: { metaTag: "og:title" },
    // Company is pulled from the "View {Company}" link title attribute — the
    // Experteer breadcrumb uses Tailwind class soup so a selector/regex pair
    // is the only reliable path.
    company: {
      selector: "__raw__",
      regex: '<a\\s+title="View ([^"]+)"',
    },
    // Location is embedded in the URL slug — `...-{city}-{country}-{numericId}`.
    // Extract the final two non-numeric tokens before the id.
    location: {
      selector: "__raw__",
      regex:
        'property="og:url"\\s+content="[^"]*?/view-jobs/[a-z0-9-]+-([a-z]+-[a-z]+)-\\d+"',
      transform: { pattern: "-", replacement: ", " },
    },
    description: {
      selector: "__raw__",
      regex: "Stellenbeschreibung</h2>\\s*<div>([\\s\\S]*?)</div>",
    },
    descriptionFallback: { metaTag: "og:description" },
  },
};
