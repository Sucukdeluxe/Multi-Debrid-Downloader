const DOMAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "rapidgator.net": "rapidgator",
  "rapidgator.asia": "rapidgator",
  "rg.to": "rapidgator"
});

export function normalizeHosterHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  for (const [domain, hoster] of Object.entries(DOMAIN_ALIASES)) {
    if (normalized === domain || normalized.endsWith(`.${domain}`)) {
      return hoster;
    }
  }
  const parts = normalized.split(".").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : normalized;
}

export function extractHosterFromUrl(url: string): string {
  try {
    return normalizeHosterHostname(new URL(url).hostname);
  } catch {
    return "";
  }
}
