/**
 * Site-template contract. Shared with HTTP and Playwright scrapers.
 *
 * A template declares how to locate and extract structured job fields for one
 * job board. HTTP templates use regex/selector-based field extractors.
 * Playwright templates provide an async function that drives a browser.
 */

import type { Page } from "playwright";

export type ScrapedJob = {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  templateName: string;
  extra?: Record<string, string>;
};

export type ScrapeResult = {
  job: ScrapedJob;
  rawHtml: string;
  status: number;
};

export type FieldExtractor = {
  selector?: string;
  regex?: string;
  metaTag?: string;
  /** Dot-path into a JSON-LD JobPosting block (e.g., "title", "hiringOrganization.name", "jobLocation.address.addressLocality"). */
  jsonLdPath?: string;
  transform?: { pattern: string; replacement: string };
};

export type HttpTemplate = {
  name: string;
  urlPattern: RegExp;
  method: "http";
  headers?: Record<string, string>;
  fields: {
    title: FieldExtractor;
    company: FieldExtractor;
    location: FieldExtractor;
    description: FieldExtractor;
    descriptionFallback?: FieldExtractor;
    [extra: string]: FieldExtractor | undefined;
  };
};

export type ApiTemplate = {
  name: string;
  urlPattern: RegExp;
  method: "api";
  fields: Record<string, FieldExtractor>; // unused — apiExtract handles everything
  /** Turn a public URL into the JSON-API URL to fetch. */
  apiUrl: (url: string) => string;
  /** Parse the JSON payload into structured job fields. */
  apiExtract: (json: unknown, url: string) => Partial<ScrapedJob>;
  /** Optional fetch init (headers, method, body) for the API call. */
  fetchInit?: (url: string) => RequestInit;
};

export type PlaywrightTemplate = {
  name: string;
  urlPattern: RegExp;
  method: "playwright";
  fields: Record<string, FieldExtractor>; // unused but type-compat with HttpTemplate
  playwrightExtract: (page: Page, url: string) => Promise<Partial<ScrapedJob>>;
};

export type SiteTemplate = HttpTemplate | ApiTemplate | PlaywrightTemplate;
