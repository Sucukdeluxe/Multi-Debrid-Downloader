const formatters = new Map<string, Intl.NumberFormat>();

function decimal(value: number, digits: number, locale: string): string {
  const key = `${locale}:${digits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatSpeed(bytesPerSecond: number, locale = "de-DE"): string {
  const value = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0;
  if (value >= 1_000_000_000) return `${decimal(value / 1_000_000_000, 2, locale)} GB/s`;
  if (value >= 1_000_000) return `${decimal(value / 1_000_000, 2, locale)} MB/s`;
  if (value >= 1_000) return `${decimal(value / 1_000, 1, locale)} kB/s`;
  return `${Math.round(value)} B/s`;
}

export function speedLimitBytesPerSecond(limitKbps: number): number {
  return Math.max(0, Number(limitKbps) || 0) * 1000;
}
