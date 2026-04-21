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

export type FieldExtractor = {
  selector?: string;
  regex?: string;
  metaTag?: string;
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

export type PlaywrightTemplate = {
  name: string;
  urlPattern: RegExp;
  method: "playwright";
  fields: Record<string, FieldExtractor>; // unused but type-compat with HttpTemplate
  playwrightExtract: (page: Page, url: string) => Promise<Partial<ScrapedJob>>;
};

export type SiteTemplate = HttpTemplate | PlaywrightTemplate;
