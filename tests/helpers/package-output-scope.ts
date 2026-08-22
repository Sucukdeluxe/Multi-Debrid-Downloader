import path from "node:path";
import { PackageOutputScope } from "../../src/main/package-output-scope";
import type { PackageEntry } from "../../src/shared/types";

export function registerPackageCompleteOutputs(pkg: PackageEntry, outputPaths: readonly string[]): PackageOutputScope {
  const roots = [pkg.outputDir, pkg.extractDir].filter((root): root is string => Boolean(String(root || "").trim()));
  const scope = new PackageOutputScope(roots);
  const archivePath = path.resolve(pkg.outputDir || pkg.extractDir, "fixture-source.archive");
  for (const outputPath of outputPaths) {
    const relativePath = path.relative(pkg.extractDir, outputPath).replace(/\\/g, "/");
    scope.add({
      version: 1,
      archivePath,
      entryPath: relativePath && !relativePath.startsWith("../") ? relativePath : path.basename(outputPath),
      outputPath,
      state: "complete",
      disposition: "written"
    });
  }
  pkg.outputProvenanceVersion = 1;
  pkg.outputRecords = scope.records();
  pkg.outputCount = scope.records().length;
  return scope;
}
