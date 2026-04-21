/**
 * job-room.ch (ORP/NPA) API client — Browser Proxy.
 *
 * Routes all API calls through Chrome via macOS AppleScript/JXA.
 * job-room.ch uses httpOnly session cookies from idp.arbeit.swiss SSO
 * that cannot be extracted or replicated via external HTTP calls.
 * The browser handles all authentication automatically.
 *
 * Requirements:
 *   - macOS (uses osascript)
 *   - Google Chrome with an active job-room.ch tab (user must be logged in)
 *
 * API base: https://www.job-room.ch/onlineform-service/api/npa
 */

import { exec } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const NPA_BASE = "https://www.job-room.ch/onlineform-service/api/npa";
const USER_BASE = "https://www.job-room.ch/user-service/api";

// Cached user ID from session check
let cachedUserId = "";

/**
 * Execute JavaScript in the Chrome tab that has job-room.ch open.
 * Finds the tab automatically across all Chrome windows.
 */
async function chromeExec(browserJs: string): Promise<string> {
  const id = `jr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jsFile = join(tmpdir(), `${id}.js`);
  const jxaFile = join(tmpdir(), `${id}-jxa.js`);

  await writeFile(jsFile, browserJs);

  const jxa = [
    "ObjC.import('Foundation');",
    "const app = Application('Google Chrome');",
    `const nsData = $.NSString.stringWithContentsOfFileEncodingError(${JSON.stringify(jsFile)}, $.NSUTF8StringEncoding, null);`,
    "const jsCode = ObjC.unwrap(nsData);",
    "",
    "function run() {",
    "  const wins = app.windows();",
    "  for (let i = 0; i < wins.length; i++) {",
    "    const tabs = wins[i].tabs();",
    "    for (let j = 0; j < tabs.length; j++) {",
    "      if (tabs[j].url().includes('job-room.ch')) {",
    "        return tabs[j].execute({javascript: jsCode});",
    "      }",
    "    }",
    "  }",
    "  return JSON.stringify({error: 'NO_TAB', message: 'No job-room.ch tab found in Chrome. Please open job-room.ch and log in.'});",
    "}",
    "run();",
  ].join("\n");

  await writeFile(jxaFile, jxa);

  try {
    const output = await new Promise<string>((resolve, reject) => {
      exec(`osascript -l JavaScript ${JSON.stringify(jxaFile)}`, {
        encoding: "utf-8",
        timeout: 30000,
      }, (error, stdout, stderr) => {
        if (error) {
          // Chrome not running or permission denied
          if (stderr?.includes("not running")) {
            reject(new Error("Google Chrome is not running. Please open Chrome and navigate to job-room.ch."));
          } else {
            reject(new Error(`osascript failed: ${stderr || error.message}`));
          }
        } else {
          resolve(stdout.trim());
        }
      });
    });
    return output;
  } finally {
    await Promise.allSettled([unlink(jsFile), unlink(jxaFile)]);
  }
}

/**
 * Make a job-room.ch API request via Chrome browser proxy.
 * The browser's session cookies and JWT handle authentication.
 */
async function jobroomRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  // Build browser JS. Use JSON.stringify for safe embedding of values.
  // For the body, double-stringify produces a JS string literal.
  const bodyLiteral = body != null
    ? JSON.stringify(JSON.stringify(body))
    : "null";

  const browserJs = `(function() {
  var token = sessionStorage.getItem('authenticationToken');
  if (!token) return JSON.stringify({error: 'NO_AUTH', message: 'Not logged in to job-room.ch. Please log in and try again.'});

  var method = ${JSON.stringify(method)};
  var body = ${bodyLiteral};

  // Dedup guard: block duplicate POST/PUT requests within 5 seconds
  if (method === 'POST' || method === 'PUT') {
    var dedupKey = '__jr_dedup_' + method + '_' + (body || '').substring(0, 100);
    var lastCall = window[dedupKey];
    var now = Date.now();
    if (lastCall && (now - lastCall) < 5000) {
      return JSON.stringify({deduplicated: true, message: 'Duplicate request blocked (same body within 5s)'});
    }
    window[dedupKey] = now;
  }

  var lang = (document.cookie.match(/NG_TRANSLATE_LANG_KEY=([^;]+)/) || [])[1] || 'de';
  var ng = btoa(lang);
  var path = ${JSON.stringify(path)};
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  var url = path + sep + '_ng=' + ng;

  var req = new XMLHttpRequest();
  req.open(method, url, false);
  req.setRequestHeader('Authorization', token);
  req.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
  req.setRequestHeader('Accept', 'application/json');
  if (method !== 'GET' && method !== 'DELETE') {
    req.setRequestHeader('Content-Type', 'application/json');
  }
  req.withCredentials = true;

  try {
    req.send(body);
    if (req.status >= 200 && req.status < 300) {
      return req.responseText || JSON.stringify({ok: true});
    }
    return JSON.stringify({error: 'HTTP_' + req.status, status: req.status, detail: req.responseText.substring(0, 1000)});
  } catch(e) {
    return JSON.stringify({error: 'NETWORK', message: e.message});
  }
})()`;

  const result = await chromeExec(browserJs);

  try {
    const parsed = JSON.parse(result);
    if (parsed?.error) {
      throw new Error(`job-room.ch: ${parsed.error} — ${parsed.message || parsed.detail || ""}`);
    }
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      return result; // Not JSON, return raw text
    }
    throw e;
  }
}

// --- Session check ---

/** Check if Chrome has an active job-room.ch session. Returns user info. */
export async function checkSession(): Promise<{
  ok: boolean;
  userId?: string;
  user?: unknown;
  error?: string;
}> {
  try {
    const user = await jobroomRequest("GET", `${USER_BASE}/current-user`) as Record<string, unknown>;
    cachedUserId = user.id as string;
    return { ok: true, userId: cachedUserId, user };
  } catch (err) {
    cachedUserId = "";
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Get cached or fresh user ID */
export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const session = await checkSession();
  if (!session.ok || !session.userId) {
    throw new Error(session.error || "Not logged in to job-room.ch");
  }
  return session.userId;
}

// --- Proof of Work Efforts ---

export interface ProofRecord {
  id: string;
  status: string;
  controlPeriod?: { type: string; value: string };
  workEfforts?: WorkEffort[];
}

export interface WorkEffort {
  id: string;
  applyDate: string;
  occupation: string;
  applyStatus: string[];
  fullTimeJob: boolean;
  applyChannel: {
    contactPerson?: string;
    email?: string;
    formUrl?: string;
    phone?: string;
    types: string[];
    address?: {
      name: string;
      street?: string;
      houseNumber?: string;
      postalCode?: string;
      country?: string;
      city?: string;
    };
  };
}

/** List user's proof records (monthly containers) */
export async function listProofs(userId?: string, page = 0): Promise<unknown> {
  const uid = userId || await getUserId();
  return jobroomRequest(
    "GET",
    `${NPA_BASE}/_search/by-owner-user-id?userId=${uid}&page=${page}`,
  );
}

/** Get a single proof record with its work efforts */
export async function getProof(proofId: string): Promise<unknown> {
  return jobroomRequest("GET", `${NPA_BASE}/${proofId}`);
}

// --- Work Effort CRUD ---

export interface CreateWorkEffortData {
  occupation: string;
  applyDate: string;
  companyName: string;
  companyStreet?: string;
  companyHouseNumber?: string;
  companyPostalCode?: string;
  companyCity?: string;
  companyCountry?: string;
  contactPerson?: string;
  email?: string;
  formUrl?: string;
  phone?: string;
  applyChannelTypes?: string[];
  applyStatus?: string[];
  fullTimeJob?: boolean;
}

/** Build the job-room.ch work effort payload from our simplified input */
function buildWorkEffortPayload(data: CreateWorkEffortData): Record<string, unknown> {
  return {
    id: null,
    applyDate: data.applyDate,
    ravAssigned: false,
    applyChannel: {
      contactPerson: data.contactPerson || null,
      email: data.email || null,
      formUrl: data.formUrl || null,
      phone: data.phone || null,
      types: data.applyChannelTypes || ["ELECTRONIC"],
      address: {
        name: data.companyName,
        street: data.companyStreet || null,
        houseNumber: data.companyHouseNumber || null,
        postalCode: data.companyPostalCode || null,
        country: data.companyCountry || "CH",
        city: data.companyCity || null,
        poBox: null,
      },
    },
    applyStatus: data.applyStatus || ["PENDING"],
    occupation: data.occupation,
    fullTimeJob: data.fullTimeJob !== false,
    rejectionReason: null,
    jobAdvertisementId: null,
  };
}

/** Create a new work effort in a proof record (with dedup check) */
export async function createWorkEffort(
  data: CreateWorkEffortData,
  userId?: string,
): Promise<unknown> {
  const uid = userId || await getUserId();

  // Dedup check: look for existing effort with same company + occupation in current month
  const existing = await findExistingEffort(data, uid);
  if (existing) {
    return {
      deduplicated: true,
      message: `Work effort already exists: "${data.occupation}" at ${data.companyName} (${data.applyDate}). Skipping creation.`,
      existingId: (existing as Record<string, unknown>).id,
    };
  }

  const payload = buildWorkEffortPayload(data);
  return jobroomRequest(
    "POST",
    `${NPA_BASE}/_action/add-work-effort?userId=${uid}`,
    payload,
  );
}

/** Check if a matching work effort already exists for this month */
async function findExistingEffort(
  data: CreateWorkEffortData,
  userId: string,
): Promise<unknown | null> {
  try {
    const proofs = await listProofs(userId, 0) as {
      content?: Array<{ id: string; controlPeriod?: { value: string } }>;
    };

    if (!proofs?.content?.length) return null;

    // Find the proof for the target month (YYYY-MM)
    const targetMonth = data.applyDate.substring(0, 7);
    const proof = proofs.content.find(
      (p) => p.controlPeriod?.value === targetMonth,
    );
    if (!proof) return null;

    // Get full proof with work efforts
    const fullProof = await getProof(proof.id) as { workEfforts?: WorkEffort[] };

    if (!fullProof?.workEfforts?.length) return null;

    // Match by company name + occupation (case-insensitive)
    const companyLower = data.companyName.toLowerCase();
    const occupationLower = data.occupation.toLowerCase();
    return fullProof.workEfforts.find((e) => {
      const existingCompany = (e.applyChannel?.address?.name || "").toLowerCase();
      const existingOccupation = (e.occupation || "").toLowerCase();
      return existingCompany === companyLower && existingOccupation === occupationLower;
    }) || null;
  } catch {
    // If dedup check fails, proceed with creation (fail-open)
    return null;
  }
}

/** Update an existing work effort */
export async function updateWorkEffort(
  data: CreateWorkEffortData & { id: string },
  userId?: string,
): Promise<unknown> {
  const uid = userId || await getUserId();
  const payload = { ...buildWorkEffortPayload(data), id: data.id };
  return jobroomRequest(
    "POST",
    `${NPA_BASE}/_action/update-work-effort?userId=${uid}`,
    payload,
  );
}

/** Delete a work effort */
export async function deleteWorkEffort(
  proofId: string,
  workEffortId: string,
): Promise<unknown> {
  return jobroomRequest(
    "DELETE",
    `${NPA_BASE}/${proofId}/work-efforts/${workEffortId}`,
  );
}

// --- Helpers ---

/** Map an SL job to a work effort creation payload */
export function slJobToWorkEffort(
  job: Record<string, unknown>,
  applyDate?: string,
): CreateWorkEffortData {
  const today = new Date().toISOString().split("T")[0];
  return {
    occupation: (job.position_title as string) || "",
    applyDate: applyDate || (job.applied_date as string) || today,
    companyName: (job.company as string) || "",
    companyStreet: (job.company_address_line1 as string) || undefined,
    companyPostalCode: (job.company_postal_code as string) || undefined,
    companyCity: (job.company_city as string) || undefined,
    companyCountry: (job.company_country_code as string) || "CH",
    contactPerson: (job.contact_person as string) || undefined,
    formUrl: (job.application_url as string) || (job.source_url as string) || undefined,
    applyChannelTypes: ["ELECTRONIC"],
    applyStatus: ["PENDING"],
    fullTimeJob: true,
  };
}
