export function mergeKnownTotalBytes(
  currentTotalBytes: number | null | undefined,
  replacementTotalBytes: number | null | undefined
): number | null {
  if (replacementTotalBytes != null && Number.isFinite(replacementTotalBytes) && replacementTotalBytes > 0) {
    return replacementTotalBytes;
  }
  if (currentTotalBytes != null && Number.isFinite(currentTotalBytes) && currentTotalBytes > 0) {
    return currentTotalBytes;
  }
  return null;
}
