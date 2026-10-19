import { ParsedPackageInput } from "../shared/types";
import { inferPackageNameFromLinks, parsePackagesFromLinksText, sanitizeFilename } from "./utils";

export function mergePackageInputs(packages: ParsedPackageInput[]): ParsedPackageInput[] {
  const grouped = new Map<string, { links: string[]; linkSet: Set<string>; fileNameByLink: Map<string, string> }>();
  for (const pkg of packages) {
    const name = sanitizeFilename(pkg.name || inferPackageNameFromLinks(pkg.links));
    const current = grouped.get(name) ?? { links: [], linkSet: new Set<string>(), fileNameByLink: new Map<string, string>() };
    for (let index = 0; index < pkg.links.length; index += 1) {
      const link = String(pkg.links[index] || "").trim();
      if (!link) {
        continue;
      }
      if (!current.linkSet.has(link)) {
        current.linkSet.add(link);
        current.links.push(link);
      }
      const rawFileName = String(pkg.fileNames?.[index] || "").trim();
      const fileName = rawFileName ? sanitizeFilename(rawFileName) : "";
      if (fileName && !current.fileNameByLink.has(link)) {
        current.fileNameByLink.set(link, fileName);
      }
    }
    grouped.set(name, current);
  }
  return Array.from(grouped.entries()).map(([name, entry]) => {
    const links = entry.links;
    const fileNames = links.map((link) => entry.fileNameByLink.get(link) || "");
    return {
      name,
      links,
      ...(fileNames.some((fileName) => fileName.length > 0) ? { fileNames } : {})
    };
  });
}

export function parseCollectorInput(rawText: string, packageName = ""): ParsedPackageInput[] {
  const parsed = parsePackagesFromLinksText(rawText, packageName);
  if (parsed.length === 0) {
    return [];
  }
  return mergePackageInputs(parsed);
}
