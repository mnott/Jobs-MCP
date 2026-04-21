/**
 * Link unwrapping — resolve tracker/redirect URLs to the actual JD URL.
 *
 * Job-alert emails almost never link directly to the JD. They wrap the real
 * URL in a tracker. Failing to unwrap sends the scraper to a redirect shim
 * and yields garbage.
 *
 * Handles:
 *   - Google Alerts: google.com/url?q=<real>
 *   - LinkedIn /comm/ alerts: linkedin.com/comm/jobs/view/<id>?…
 *   - Experteer: link.experteer.ch/c/<hash> (needs HTTP HEAD to resolve)
 *   - Generic: Indeed cts.indeed.com/v3/, JobUp UTM params, etc.
 *
 * Synchronous resolvers return a cleaned URL directly. Async resolvers (the
 * ones that need to follow a redirect) return a promise.
 */

export type UnwrapResult = {
  original: string;
  unwrapped: string;
  kind: "google-alert" | "linkedin-comm" | "experteer" | "generic-utm" | "none";
  note?: string;
};

const GOOGLE_ALERT_RE = /^https?:\/\/(?:www\.)?google\.com\/url\?/i;
const LINKEDIN_COMM_RE = /linkedin\.com\/comm\/jobs\/view\/(\d+)/i;
const EXPERTEER_RE = /^https?:\/\/link\.experteer\.ch\/c\//i;

/** Strip known tracking query params (UTM and friends) */
function stripTrackingParams(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const drop = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "eBP",
      "trackingId",
      "trk",
      "refId",
      "lipi",
      "midToken",
      "midSig",
      "trkEmail",
      "_ga",
    ]);
    for (const key of [...u.searchParams.keys()]) {
      if (drop.has(key)) u.searchParams.delete(key);
    }
    // Tidy: if no params left, drop the ? entirely
    if (u.searchParams.toString() === "") u.search = "";
    return u.toString();
  } catch {
    return urlStr;
  }
}

/** Synchronous unwrap attempt — covers Google Alerts + LinkedIn /comm/ */
export function unwrapSync(urlStr: string): UnwrapResult {
  // Google Alerts wrapper: extract ?q=
  if (GOOGLE_ALERT_RE.test(urlStr)) {
    try {
      const real = new URL(urlStr).searchParams.get("q");
      if (real) {
        return {
          original: urlStr,
          unwrapped: stripTrackingParams(decodeURIComponent(real)),
          kind: "google-alert",
        };
      }
    } catch {
      /* fall through */
    }
  }

  // LinkedIn /comm/ alerts: strip /comm/ and query
  const li = urlStr.match(LINKEDIN_COMM_RE);
  if (li) {
    const jobId = li[1];
    return {
      original: urlStr,
      unwrapped: `https://www.linkedin.com/jobs/view/${jobId}`,
      kind: "linkedin-comm",
    };
  }

  // Generic: strip tracking params only
  const cleaned = stripTrackingParams(urlStr);
  if (cleaned !== urlStr) {
    return { original: urlStr, unwrapped: cleaned, kind: "generic-utm" };
  }

  return { original: urlStr, unwrapped: urlStr, kind: "none" };
}

/** Async unwrap: like sync, but also follows HTTP redirects for trackers
 *  that require network resolution (Experteer, Indeed cts.). */
export async function unwrapAsync(urlStr: string): Promise<UnwrapResult> {
  // First try sync
  const sync = unwrapSync(urlStr);
  if (sync.kind !== "none") return sync;

  // Experteer and other redirect-only trackers: do a HEAD, follow
  if (EXPERTEER_RE.test(urlStr) || /cts\.indeed\.com\/v3\//i.test(urlStr)) {
    try {
      const resp = await fetch(urlStr, { method: "HEAD", redirect: "follow" });
      const resolved = resp.url;
      if (resolved && resolved !== urlStr) {
        return {
          original: urlStr,
          unwrapped: stripTrackingParams(resolved),
          kind: "experteer",
          note: `Resolved via ${resp.status} redirect chain`,
        };
      }
    } catch (err) {
      return {
        original: urlStr,
        unwrapped: urlStr,
        kind: "none",
        note: `HEAD failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return sync;
}
