/**
 * job-room.ch Public Job Search API client.
 *
 * Uses the unauthenticated public search API at:
 *   POST https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search
 *   GET  https://www.job-room.ch/jobadservice/api/jobAdvertisements/{id}
 *
 * No API key or credentials needed — this is the same API the job-room.ch
 * Angular frontend uses for public job search.
 */

const JOBROOM_BASE = "https://www.job-room.ch/jobadservice/api/jobAdvertisements";

// --- Types ---

export interface JobroomSearchParams {
  keywords?: string[];
  cantonCodes?: string[];
  communalCodes?: string[];
  workloadPercentageMin?: number;
  workloadPercentageMax?: number;
  permanent?: boolean;
  onlineSince?: number;
  companyName?: string;
  professionCodes?: string[];
  language?: string;
  radiusSearchRequest?: {
    geoPoint: { lat: number; lon: number };
    distance: number;
  };
}

export interface JobroomSearchResult {
  totalCount: number;
  page: number;
  size: number;
  jobs: JobroomJobSummary[];
}

export interface JobroomJobSummary {
  id: string;
  title: string;
  company: string;
  city: string;
  canton: string;
  workloadMin: number;
  workloadMax: number;
  permanent: boolean;
  publishedDate: string;
  externalUrl: string | null;
  sourceSystem: string;
}

export interface JobroomJobDetail {
  id: string;
  stellennummerEgov: string | null;
  status: string;
  sourceSystem: string;
  createdTime: string;
  title: string;
  description: string;
  language: string;
  company: {
    name: string;
    street: string | null;
    houseNumber: string | null;
    postalCode: string | null;
    city: string | null;
    countryIsoCode: string | null;
    website: string | null;
    surrogate: boolean;
  };
  location: {
    city: string;
    postalCode: string;
    cantonCode: string | null;
    countryIsoCode: string;
    coordinates: { lat: string; lon: string } | null;
  };
  employment: {
    startDate: string | null;
    endDate: string | null;
    permanent: boolean;
    immediately: boolean;
    workloadPercentageMin: string;
    workloadPercentageMax: string;
    workForms: string[];
  };
  languageSkills: Array<{
    languageIsoCode: string;
    spokenLevel: string | null;
    writtenLevel: string | null;
  }>;
  applyChannel: {
    formUrl: string | null;
    emailAddress: string | null;
    phoneNumber: string | null;
    mailAddress: string | null;
  } | null;
  publicContact: {
    salutation: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  externalUrl: string | null;
  publication: {
    startDate: string;
    endDate: string | null;
  };
}

// --- Helpers ---

/** Strip <em> highlight tags from search results */
function stripHighlight(text: string): string {
  return text.replace(/<\/?em>/g, "");
}

// --- API functions ---

/**
 * Search for jobs on job-room.ch.
 * Returns a simplified list with pagination info.
 */
export async function searchJobs(
  params: JobroomSearchParams,
  page = 0,
  size = 20,
): Promise<JobroomSearchResult> {
  const url = `${JOBROOM_BASE}/_search?page=${page}&size=${size}`;

  // Build request body — only include non-undefined fields
  const body: Record<string, unknown> = {};
  if (params.keywords?.length) body.keywords = params.keywords;
  if (params.cantonCodes?.length) body.cantonCodes = params.cantonCodes;
  if (params.communalCodes?.length) body.communalCodes = params.communalCodes;
  if (params.workloadPercentageMin != null) body.workloadPercentageMin = params.workloadPercentageMin;
  if (params.workloadPercentageMax != null) body.workloadPercentageMax = params.workloadPercentageMax;
  if (params.permanent != null) body.permanent = params.permanent;
  if (params.onlineSince != null) body.onlineSince = params.onlineSince;
  if (params.companyName) body.companyName = params.companyName;
  if (params.professionCodes?.length) body.professionCodes = params.professionCodes;
  if (params.language) body.language = params.language;
  if (params.radiusSearchRequest) body.radiusSearchRequest = params.radiusSearchRequest;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`job-room.ch search failed: HTTP ${response.status} — ${text}`);
  }

  const totalCount = parseInt(response.headers.get("X-Total-Count") || "0", 10);
  const results = await response.json() as Array<{ jobAdvertisement: Record<string, unknown> }>;

  const jobs: JobroomJobSummary[] = results.map((item) => {
    const ja = item.jobAdvertisement as Record<string, unknown>;
    const jc = ja.jobContent as Record<string, unknown>;
    const descs = (jc?.jobDescriptions as Array<Record<string, string>>) || [];
    const company = jc?.company as Record<string, string> | undefined;
    const location = jc?.location as Record<string, string> | undefined;
    const employment = jc?.employment as Record<string, unknown> | undefined;

    return {
      id: ja.id as string,
      title: stripHighlight(descs[0]?.title || "Unknown"),
      company: company?.name || "Unknown",
      city: location?.city || "",
      canton: location?.cantonCode || "",
      workloadMin: parseInt(String(employment?.workloadPercentageMin || "0"), 10),
      workloadMax: parseInt(String(employment?.workloadPercentageMax || "100"), 10),
      permanent: employment?.permanent === true,
      publishedDate: ((ja.publication as Record<string, string>)?.startDate) || "",
      externalUrl: (jc?.externalUrl as string) || null,
      sourceSystem: ja.sourceSystem as string || "",
    };
  });

  return { totalCount, page, size, jobs };
}

/**
 * Get full details of a single job listing by UUID.
 */
export async function getJob(jobId: string): Promise<JobroomJobDetail> {
  const response = await fetch(`${JOBROOM_BASE}/${jobId}`, {
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`job-room.ch get job failed: HTTP ${response.status} — ${text}`);
  }

  const raw = await response.json() as Record<string, unknown>;
  const jc = raw.jobContent as Record<string, unknown>;
  const descs = (jc?.jobDescriptions as Array<Record<string, string>>) || [];
  const company = jc?.company as Record<string, unknown> | undefined;
  const location = jc?.location as Record<string, unknown> | undefined;
  const employment = jc?.employment as Record<string, unknown> | undefined;
  const applyChannel = jc?.applyChannel as Record<string, string> | undefined;
  const publicContact = jc?.publicContact as Record<string, string> | undefined;
  const publication = raw.publication as Record<string, string> | undefined;

  return {
    id: raw.id as string,
    stellennummerEgov: raw.stellennummerEgov as string | null,
    status: raw.status as string,
    sourceSystem: raw.sourceSystem as string,
    createdTime: raw.createdTime as string,
    title: stripHighlight(descs[0]?.title || "Unknown"),
    description: stripHighlight(descs[0]?.description || ""),
    language: descs[0]?.languageIsoCode || "de",
    company: {
      name: (company?.name as string) || "Unknown",
      street: (company?.street as string) || null,
      houseNumber: (company?.houseNumber as string) || null,
      postalCode: (company?.postalCode as string) || null,
      city: (company?.city as string) || null,
      countryIsoCode: (company?.countryIsoCode as string) || null,
      website: (company?.website as string) || null,
      surrogate: company?.surrogate === true,
    },
    location: {
      city: (location?.city as string) || "",
      postalCode: (location?.postalCode as string) || "",
      cantonCode: (location?.cantonCode as string) || null,
      countryIsoCode: (location?.countryIsoCode as string) || "CH",
      coordinates: location?.coordinates as { lat: string; lon: string } | null,
    },
    employment: {
      startDate: (employment?.startDate as string) || null,
      endDate: (employment?.endDate as string) || null,
      permanent: employment?.permanent === true,
      immediately: employment?.immediately === true,
      workloadPercentageMin: String(employment?.workloadPercentageMin || "0"),
      workloadPercentageMax: String(employment?.workloadPercentageMax || "100"),
      workForms: (employment?.workForms as string[]) || [],
    },
    languageSkills: ((jc?.languageSkills as Array<Record<string, string>>) || []).map((ls) => ({
      languageIsoCode: ls.languageIsoCode || "",
      spokenLevel: ls.spokenLevel || null,
      writtenLevel: ls.writtenLevel || null,
    })),
    applyChannel: applyChannel ? {
      formUrl: applyChannel.formUrl || null,
      emailAddress: applyChannel.emailAddress || null,
      phoneNumber: applyChannel.phoneNumber || null,
      mailAddress: applyChannel.rawPostAddress || null,
    } : null,
    publicContact: publicContact ? {
      salutation: publicContact.salutation || null,
      firstName: publicContact.firstName || null,
      lastName: publicContact.lastName || null,
      phone: publicContact.phone || null,
      email: publicContact.email || null,
    } : null,
    externalUrl: (jc?.externalUrl as string) || null,
    publication: {
      startDate: publication?.startDate || "",
      endDate: publication?.endDate || null,
    },
  };
}

/**
 * Map a job-room.ch job detail to SeriousLetter CreateJob fields.
 */
export function mapToSeriousLetter(job: JobroomJobDetail): Record<string, unknown> {
  const contactParts: string[] = [];
  if (job.publicContact?.firstName && job.publicContact?.lastName) {
    const salutation = job.publicContact.salutation === "MR" ? "Mr." :
      job.publicContact.salutation === "MS" ? "Ms." : "";
    contactParts.push(`${salutation} ${job.publicContact.firstName} ${job.publicContact.lastName}`.trim());
  }

  const isAgency = job.company.surrogate;

  return {
    company: job.company.name,
    position_title: job.title,
    source_url: job.externalUrl || `https://www.job-room.ch/job-search/${job.id}`,
    application_url: job.applyChannel?.formUrl || job.applyChannel?.emailAddress
      ? `mailto:${job.applyChannel.emailAddress}` : undefined,
    location: [job.location.city, job.location.cantonCode].filter(Boolean).join(", "),
    language: job.language,
    job_description: job.description,
    is_recruiting_agency: isAgency,
    contact_person: contactParts[0] || undefined,
    company_city: job.company.city || job.location.city || undefined,
    company_postal_code: job.company.postalCode || job.location.postalCode || undefined,
    company_country_code: job.company.countryIsoCode || job.location.countryIsoCode || undefined,
    company_address_line1: job.company.street
      ? `${job.company.street}${job.company.houseNumber ? " " + job.company.houseNumber : ""}`
      : undefined,
  };
}
