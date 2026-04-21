/**
 * Liveness classifier — pure function, zero LLM.
 *
 * Ported concept from santifer/career-ops (liveness-core.mjs). Decides if a
 * job posting is still accepting applications based on:
 *   - hard-expired text patterns in EN/DE/FR
 *   - URL redirect patterns (Greenhouse ?error=true, generic careers
 *     landing pages)
 *   - Apply-button presence in HTML
 *   - minimum content-length heuristic
 *
 * Input: final URL (after redirects) + fetched body text + optional
 * HTTP status. Returns a verdict + reason string.
 */

export type LivenessVerdict = "active" | "expired" | "uncertain";
export type LivenessResult = { verdict: LivenessVerdict; reason: string };

// Hard-expired copy in English, German, French
const EXPIRED_TEXT_PATTERNS: RegExp[] = [
  // English
  /\bthis (?:position|job|posting|role|opening|vacancy) (?:is )?(?:no longer|not) (?:available|accepting|open)\b/i,
  /\bposition (?:has been )?(?:closed|filled|removed|withdrawn)\b/i,
  /\bwe('re| are) no longer (?:accepting|considering)\b/i,
  /\bjob (?:has )?expired\b/i,
  /\bno longer accepting applications?\b/i,
  /\bapplications? (?:are )?closed\b/i,
  /\bthis requisition is (?:closed|no longer active)\b/i,

  // German
  /\bstelle(?:nausschreibung)? ist (?:nicht mehr|leider nicht mehr) (?:verfügbar|aktiv)\b/i,
  /\bposition wurde (?:besetzt|geschlossen|zurückgezogen)\b/i,
  /\bbewerbungsfrist (?:ist )?abgelaufen\b/i,
  /\bwir nehmen keine weiteren bewerbungen? (?:entgegen|an)\b/i,
  /\bnicht mehr verfügbar\b/i,

  // French
  /\b(?:cette )?offre (?:n'est plus|n'est pas|plus) (?:disponible|active|d'actualité)\b/i,
  /\bposte (?:n'est plus|plus) (?:disponible|vacant)\b/i,
  /\bcandidatures? (?:sont )?(?:closes|fermées|clôturées)\b/i,
  /\boffre expirée\b/i,
];

// URL patterns that indicate the target is no longer a valid JD
const EXPIRED_URL_PATTERNS: RegExp[] = [
  /[?&]error=true\b/i, // Greenhouse redirect on closed posting
  /[?&]jobNotFound\b/i,
  /\/careers\/?$/i, // landed on root careers page, not a JD
  /\/jobs\/?$/i, // same for generic jobs index
];

// Apply-button signals (presence of any → strong active signal).
// Conservative — attribute or innerText must explicitly reference applying.
const APPLY_BUTTON_PATTERNS: RegExp[] = [
  /\baria-label=["'][^"']*(?:apply|bewerben|postuler|candidater)[^"']*["']/i,
  /\b(?:id|class|data-test|data-modal)=["'][^"']*(?:apply-button|jobs-apply|easy-apply|topbar-apply|postuler-btn|apply-modal|apply-link)[^"']*["']/i,
  /<button[^>]*>[\s\n]*(?:apply|bewerben|postuler|candidater)\b/i,
  /<a[^>]*>[\s\n]*(?:apply now|jetzt bewerben|postuler maintenant)\b/i,
];

const MIN_CONTENT_CHARS = 300;

export type LivenessInput = {
  url: string;
  body?: string; // full HTML or text-extracted body
  status?: number; // HTTP status code
};

export function classifyLiveness(input: LivenessInput): LivenessResult {
  const { url, body, status } = input;

  // Dead on HTTP status alone
  if (status === 404 || status === 410) {
    return { verdict: "expired", reason: `HTTP ${status} — page gone` };
  }
  if (status === 403 || status === 401) {
    return { verdict: "uncertain", reason: `HTTP ${status} — gated, cannot verify` };
  }

  // URL patterns
  for (const pat of EXPIRED_URL_PATTERNS) {
    if (pat.test(url)) {
      return { verdict: "expired", reason: `Final URL matches expired pattern: ${pat.source}` };
    }
  }

  if (!body) {
    return { verdict: "uncertain", reason: "No body supplied — cannot classify content" };
  }

  // Hard-expired text in body
  for (const pat of EXPIRED_TEXT_PATTERNS) {
    const match = body.match(pat);
    if (match) {
      return { verdict: "expired", reason: `Body matched expired phrase: "${match[0]}"` };
    }
  }

  // Apply button → strong active signal
  for (const pat of APPLY_BUTTON_PATTERNS) {
    if (pat.test(body)) {
      return { verdict: "active", reason: "Apply button detected" };
    }
  }

  // Minimum content heuristic — stubs or redirect targets tend to be tiny
  if (body.length < MIN_CONTENT_CHARS) {
    return {
      verdict: "uncertain",
      reason: `Body too short (${body.length} chars) — likely stub or gated page`,
    };
  }

  return {
    verdict: "uncertain",
    reason: "No definitive signal — body has content but no apply button or expiry phrase",
  };
}
