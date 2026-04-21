/**
 * Template-based scraping engine.
 *
 * Given a URL, matches it against registered site templates, fetches the HTML
 * with the template's headers, and extracts structured fields using the
 * template's field extractors. No AI model — extraction is deterministic.
 *
 * Playwright templates are supported for JS-gated sites (Glassdoor etc.) via
 * a lazy browser import. If `playwright` is not installed, playwright
 * templates fall back to an HTTP fetch attempt and an error if extraction
 * fails — keeps Jobs MCP runnable without a headless-Chromium install.
 */

import type {
  HttpTemplate,
  PlaywrightTemplate,
  SiteTemplate,
  ScrapedJob,
  ScrapeResult,
  FieldExtractor,
} from "./templates/types.js";
import { linkedinTemplate } from "./templates/linkedin.js";
import { glassdoorTemplate } from "./templates/glassdoor.js";

/** All registered site templates. Playwright-based templates use a lazy `playwright` import. */
const templates: SiteTemplate[] = [linkedinTemplate, glassdoorTemplate];

/** Find the template that matches a URL */
export function findTemplate(url: string): SiteTemplate | undefined {
  return templates.find((t) => t.urlPattern.test(url));
}

/** List all registered template names and their URL patterns */
export function listTemplates(): Array<{ name: string; pattern: string; method: string }> {
  return templates.map((t) => ({
    name: t.name,
    pattern: t.urlPattern.source,
    method: t.method,
  }));
}

/** Scrape a job listing URL using the matching template. Returns job + raw HTML + status so callers can run liveness or debug. */
export async function scrapeJob(url: string): Promise<ScrapeResult> {
  const template = findTemplate(url);
  if (!template) {
    const available = templates.map((t) => t.name).join(", ");
    throw new Error(
      `No template found for URL: ${url}\nAvailable templates: ${available}`,
    );
  }

  if (template.method === "playwright") {
    return scrapePlaywright(template, url);
  }

  return scrapeHttp(template, url);
}

async function scrapePlaywright(template: PlaywrightTemplate, url: string): Promise<ScrapeResult> {
  // Dynamic import so `playwright` stays an optional dependency.
  // If the user hasn't installed it, throw a friendly error with install hints.
  type PlaywrightModule = typeof import("playwright");
  let pw: PlaywrightModule;
  try {
    const modName = "playwright";
    pw = (await import(modName)) as PlaywrightModule;
  } catch {
    throw new Error(
      `Template "${template.name}" requires Playwright. Install it with:\n` +
        `  npm install playwright\n` +
        `  npx playwright install chromium`,
    );
  }

  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    const partial = await template.playwrightExtract(page, url);
    const rawHtml = await page.content();
    const job: ScrapedJob = {
      title: partial.title ?? "",
      company: partial.company ?? "",
      location: partial.location ?? "",
      description: partial.description ?? "",
      sourceUrl: url,
      templateName: template.name,
      extra: partial.extra ?? {},
    };
    return { job, rawHtml, status: 200 };
  } finally {
    await browser.close();
  }
}

async function scrapeHttp(template: HttpTemplate, url: string): Promise<ScrapeResult> {
  const response = await fetch(url, {
    headers: template.headers ?? {},
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} fetching ${url} (template: ${template.name})`,
    );
  }
  const html = await response.text();

  const title = extractField(html, template.fields.title) ?? "";
  const company = extractField(html, template.fields.company) ?? "";
  const location = extractField(html, template.fields.location) ?? "";
  let description = extractField(html, template.fields.description) ?? "";
  if (!description && template.fields.descriptionFallback) {
    description = extractField(html, template.fields.descriptionFallback) ?? "";
  }
  if (description) description = stripHtmlTags(description);

  const extra: Record<string, string> = {};
  for (const [key, extractor] of Object.entries(template.fields)) {
    if (!extractor) continue;
    if (["title", "company", "location", "description", "descriptionFallback"].includes(key)) {
      continue;
    }
    const value = extractField(html, extractor);
    if (value) extra[key] = value;
  }

  const job: ScrapedJob = {
    title,
    company,
    location,
    description,
    sourceUrl: url,
    templateName: template.name,
    extra,
  };
  return { job, rawHtml: html, status: response.status };
}

function extractField(html: string, extractor: FieldExtractor): string | undefined {
  let content: string | undefined;

  if (extractor.metaTag) {
    const metaRegex = new RegExp(
      `<meta\\s+(?:property|name)=["']${escapeRegex(extractor.metaTag)}["']\\s+content=["']([^"']*?)["']`,
      "i",
    );
    const match = html.match(metaRegex);
    if (match) content = match[1];

    if (!content) {
      const reversed = new RegExp(
        `<meta\\s+content=["']([^"']*?)["']\\s+(?:property|name)=["']${escapeRegex(extractor.metaTag)}["']`,
        "i",
      );
      const match2 = html.match(reversed);
      if (match2) content = match2[1];
    }
  } else if (extractor.selector && extractor.regex) {
    let region = html;
    if (extractor.selector === "<title>") {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) region = titleMatch[1];
    }
    const regex = new RegExp(extractor.regex, "is");
    const match = region.match(regex);
    if (match) content = match[1];
  } else if (extractor.selector) {
    if (extractor.selector === "<title>") {
      const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (match) content = match[1];
    }
  }

  if (content && extractor.transform) {
    content = content.replace(
      new RegExp(extractor.transform.pattern, "g"),
      extractor.transform.replacement,
    );
  }
  if (content) content = decodeHtmlEntities(content).trim();
  return content || undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
