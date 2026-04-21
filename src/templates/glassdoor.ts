/**
 * Glassdoor job-listing template (Playwright-based).
 *
 * Glassdoor blocks raw HTTP (403) and returns empty shells on JS-less
 * navigation. This template drives a headless Chromium:
 *   1. Direct navigation to the job URL.
 *   2. If no job-detail selector renders in time, re-navigate via the
 *      search page to establish cookies/context, then retry.
 *   3. Dismiss the OneTrust cookie banner if present.
 *   4. Extract title / company / location / salary / employment type /
 *      description from data-test attributes or CSS modules.
 *
 * Playwright is an optional dependency. When not installed, the lazy
 * import in scraper.ts throws a friendly message with install hints.
 */

import type { Page } from "playwright";
import type { SiteTemplate, ScrapedJob } from "./types.js";

async function textFromSelectors(page: Page, selectors: string[]): Promise<string> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      const text = await loc.textContent();
      if (text?.trim()) return text.trim();
    }
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractJobData(page: Page): Promise<Partial<ScrapedJob>> {
  const extra: Record<string, string> = {};

  const title = await textFromSelectors(page, [
    '[data-test="job-title"]',
    ".JobDetails_jobTitle__Rw_gn",
    "h1",
  ]);

  const company = await textFromSelectors(page, [
    '[data-test="employer-name"]',
    "header h4",
    ".EmployerProfile_compactEmployerName__LE242",
    ".JobDetails_companyName__mSMKs a",
  ]);

  const location = await textFromSelectors(page, [
    '[data-test="location"]',
    ".JobDetails_location__mSg5h",
    ".LocationAndWorkTypes_location__yePvI",
  ]);

  const salary = await textFromSelectors(page, [
    '[data-test="salary-estimate"]',
    ".SalaryEstimate_averageEstimate__xF_7h",
  ]);
  if (salary) extra.salary = salary;

  const empType = await textFromSelectors(page, ['[data-test="employment-type"]']);
  if (empType) extra.employmentType = empType;

  let description = "";
  const descSelectors = [
    '[data-test="job-description"]',
    ".JobDetails_jobDescription__uW_fK",
    ".JobDetails_jobDescriptionWrapper__BTDTA",
  ];
  for (const sel of descSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      const html = await loc.innerHTML();
      if (html?.trim()) {
        description = stripHtml(html);
        break;
      }
    }
  }

  return { title, company, location, description, extra };
}

export const glassdoorTemplate: SiteTemplate = {
  name: "Glassdoor",
  urlPattern: /glassdoor\.\w+\/(?:job-listing\/|partner\/jobListing\.htm)/,
  method: "playwright",
  fields: {
    title: { selector: "<title>" },
    company: { selector: "<title>" },
    location: { selector: "<title>" },
    description: { selector: "<title>" },
  },

  async playwrightExtract(page: Page, url: string): Promise<Partial<ScrapedJob>> {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      (globalThis as Record<string, unknown>).chrome = { runtime: {} };
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,de;q=0.8,fr;q=0.7",
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    try {
      await page.waitForSelector(
        '[data-test="job-title"], .JobDetails_jobTitle__Rw_gn, h1',
        { timeout: 8000 },
      );
    } catch {
      const domain = new URL(url).origin;
      await page.goto(`${domain}/Job/jobs.htm`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector(
        '[data-test="job-title"], .JobDetails_jobTitle__Rw_gn, h1',
        { timeout: 10000 },
      );
    }

    try {
      const cookieButton = page.locator('button[id="onetrust-accept-btn-handler"]');
      if (await cookieButton.isVisible({ timeout: 1000 })) {
        await cookieButton.click();
      }
    } catch {
      // no cookie banner
    }

    await page.waitForTimeout(1500);
    return extractJobData(page);
  },
};
