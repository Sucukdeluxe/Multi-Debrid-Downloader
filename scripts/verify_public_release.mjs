import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const EXPECTED_PUBLISH = Object.freeze({
  provider: "github",
  owner: "Sucukdeluxe",
  repo: "multi-debrid-downloader"
});
const EXPECTED_PRODUCT_NAME = "Real-Debrid-Downloader";
const EXPECTED_NSIS_ARTIFACT_NAME = "${productName}-Setup-${version}.${ext}";
const EXPECTED_PORTABLE_ARTIFACT_NAME = "${productName}-${version}-portable.${ext}";
const REQUIRED_BUILD_FILES = Object.freeze([
  "resources/extractor-jvm/**/*",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
]);
const EXPECTED_EXTRA_RESOURCE = Object.freeze({
  from: "LICENSE",
  to: "LICENSE"
});
const EXPECTED_ICON_RESOURCE = Object.freeze({
  from: "assets/app_icon.ico",
  to: "assets/app_icon.ico"
});
const REDISTRIBUTION_FILES = Object.freeze([
  Object.freeze({
    sourcePath: "LICENSE",
    packagedPath: "resources/LICENSE",
    sha256: "f2c1bc02d9ba5235cc67dfea734e7dc90559b00d8cb2d142bad7a984ff96d3f6"
  }),
  Object.freeze({
    sourcePath: "THIRD_PARTY_NOTICES.md",
    packagedPath: "resources/THIRD_PARTY_NOTICES.md",
    sha256: "28f9d1f8692811758c41584e59d0db6cbf26654b4b93e335626921bef86bdf76"
  }),
  Object.freeze({
    sourcePath: "resources/extractor-jvm/licenses/LGPL-2.1.txt",
    packagedPath: "resources/app.asar.unpacked/resources/extractor-jvm/licenses/LGPL-2.1.txt",
    sha256: "20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95"
  }),
  Object.freeze({
    sourcePath: "resources/extractor-jvm/licenses/7-Zip-license.txt",
    packagedPath: "resources/app.asar.unpacked/resources/extractor-jvm/licenses/7-Zip-license.txt",
    sha256: "477e15d4033026edb25d36c9f078bb0beafc9318f6505473648972a536ece263"
  }),
  Object.freeze({
    sourcePath: "resources/extractor-jvm/licenses/Apache-2.0.txt",
    packagedPath: "resources/app.asar.unpacked/resources/extractor-jvm/licenses/Apache-2.0.txt",
    sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
  }),
  Object.freeze({
    sourcePath: "resources/extractor-jvm/THIRD_PARTY_NOTICES.txt",
    packagedPath: "resources/app.asar.unpacked/resources/extractor-jvm/THIRD_PARTY_NOTICES.txt",
    sha256: "d4ab6ee9ba293f9d25d22e0506a465d79794259274a0ec944d3bb3d001b46ca9"
  })
]);

function readRequiredFile(filePath) {
  requireNonEmptyFile(filePath, "required file");
  return fs.readFileSync(filePath, "utf8");
}

function parseYamlDocument(content, sourceName) {
  let value;
  try {
    value = parse(content, { uniqueKeys: true });
  } catch (error) {
    throw new Error(`${sourceName} contains invalid YAML: ${String(error?.message || error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceName} must contain a YAML mapping`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${expected}, received ${String(actual)}`);
  }
}

function resolveReleaseDir(rootDir) {
  const directLatest = path.join(rootDir, "latest.yml");
  if (fs.existsSync(directLatest)) {
    return rootDir;
  }
  return path.join(rootDir, "release");
}

function requireNonEmptyFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${filePath}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symbolic link: ${filePath}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`${label} must be a non-empty regular file: ${filePath}`);
  }
  return stat;
}

function sha256NormalizedText(filePath) {
  const normalized = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function verifyRedistributionFiles(baseDir, pathKey, label) {
  for (const file of REDISTRIBUTION_FILES) {
    const relativePath = file[pathKey];
    const filePath = path.join(baseDir, ...relativePath.split("/"));
    requireNonEmptyFile(filePath, `${label} redistribution file`);
    const actualDigest = sha256NormalizedText(filePath);
    if (actualDigest !== file.sha256) {
      throw new Error(`${label} redistribution content mismatch for ${relativePath}`);
    }
  }
}

function hasExtraResource(extraResources, expected) {
  const entries = Array.isArray(extraResources) ? extraResources : [extraResources];
  return entries.some((entry) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && entry.from === expected.from
    && entry.to === expected.to
  ));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyPackagedIcon(sourceRoot, packagedRoot, label) {
  const sourcePath = path.join(sourceRoot, "assets", "app_icon.ico");
  const packagedPath = path.join(packagedRoot, "resources", "assets", "app_icon.ico");
  requireNonEmptyFile(sourcePath, "source application icon");
  requireNonEmptyFile(packagedPath, `${label} application icon`);
  if (sha256File(sourcePath) !== sha256File(packagedPath)) {
    throw new Error(`${label} application icon content mismatch for resources/assets/app_icon.ico`);
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error
  };
}

function listFiles(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        files.push(entryPath);
      } else if (stat.isDirectory()) {
        pending.push(entryPath);
      } else if (stat.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function extractArchive(archivePath, outputDir, sevenZipPath, commandRunner) {
  fs.mkdirSync(outputDir, { recursive: true });
  const args = ["x", archivePath, `-o${outputDir}`, "-y", "-bb0", "-bd"];
  const result = commandRunner(sevenZipPath, args);
  if (result?.error || result?.status !== 0) {
    const detail = String(result?.error?.message || result?.stderr || result?.stdout || "unknown error").trim();
    throw new Error(`7-Zip command failed for ${archivePath}: ${detail}`);
  }
}

function extractArchiveTree(archivePath, outputDir, sevenZipPath, commandRunner, depth = 0) {
  if (depth > 5) {
    throw new Error(`Archive nesting limit exceeded for ${archivePath}`);
  }
  extractArchive(archivePath, outputDir, sevenZipPath, commandRunner);
  const nestedArchives = listFiles(outputDir).filter((filePath) => /\.7z$/i.test(filePath));
  for (let index = 0; index < nestedArchives.length; index += 1) {
    const nestedArchive = nestedArchives[index];
    const nestedOutput = path.join(outputDir, `.nested-${depth}-${index}`);
    extractArchiveTree(nestedArchive, nestedOutput, sevenZipPath, commandRunner, depth + 1);
  }
}

function normalizeRelativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function verifyArchiveRedistributionFiles(extractionRoot, archiveName, sourceRoot) {
  const extractedFiles = listFiles(extractionRoot);
  for (const file of REDISTRIBUTION_FILES) {
    const suffix = file.packagedPath.toLowerCase();
    const matches = extractedFiles.filter((filePath) => {
      const relativePath = normalizeRelativePath(extractionRoot, filePath).toLowerCase();
      return relativePath === suffix || relativePath.endsWith(`/${suffix}`);
    });
    if (matches.length === 0) {
      throw new Error(`Missing redistribution file ${file.packagedPath} in archive ${archiveName}`);
    }
    for (const filePath of matches) {
      requireNonEmptyFile(filePath, `${archiveName} redistribution file`);
      const actualDigest = sha256NormalizedText(filePath);
      if (actualDigest !== file.sha256) {
        throw new Error(`Archive redistribution content mismatch for ${file.packagedPath} in ${archiveName}`);
      }
    }
  }
  const iconMatches = extractedFiles.filter((filePath) => normalizeRelativePath(extractionRoot, filePath).toLowerCase().endsWith("resources/assets/app_icon.ico"));
  if (iconMatches.length === 0) {
    throw new Error(`Missing application icon resources/assets/app_icon.ico in archive ${archiveName}`);
  }
  const sourceIconPath = path.join(sourceRoot, "assets", "app_icon.ico");
  requireNonEmptyFile(sourceIconPath, "source application icon");
  const sourceDigest = sha256File(sourceIconPath);
  for (const iconPath of iconMatches) {
    requireNonEmptyFile(iconPath, `${archiveName} application icon`);
    if (sha256File(iconPath) !== sourceDigest) {
      throw new Error(`Archive application icon content mismatch in ${archiveName}`);
    }
  }
}

function readPackageVersion(rootDir) {
  const packageJson = JSON.parse(readRequiredFile(path.join(rootDir, "package.json")));
  const version = String(packageJson.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json contains invalid version ${version || "<empty>"}`);
  }
  return { packageJson, version };
}

function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("base64");
}

export function verifyPublicRelease(rootDir = process.cwd()) {
  const absoluteRoot = path.resolve(rootDir);
  const { packageJson, version } = readPackageVersion(absoluteRoot);

  const build = packageJson.build || {};
  const publish = build.publish || {};
  assertEqual(build.productName, EXPECTED_PRODUCT_NAME, "package.json build.productName");
  assertEqual(publish.provider, EXPECTED_PUBLISH.provider, "package.json publish provider");
  assertEqual(publish.owner, EXPECTED_PUBLISH.owner, "package.json publish owner");
  assertEqual(publish.repo, EXPECTED_PUBLISH.repo, "package.json publish repo");
  assertEqual(build.nsis?.artifactName, EXPECTED_NSIS_ARTIFACT_NAME, "package.json NSIS artifactName");
  assertEqual(build.portable?.artifactName, EXPECTED_PORTABLE_ARTIFACT_NAME, "package.json portable artifactName");
  const buildFiles = Array.isArray(build.files) ? build.files : [];
  const missingBuildFiles = REQUIRED_BUILD_FILES.filter((entry) => !buildFiles.includes(entry));
  if (missingBuildFiles.length > 0) {
    throw new Error(`package.json build.files omits redistribution content: ${missingBuildFiles.join(", ")}`);
  }
  if (!hasExtraResource(build.extraResources, EXPECTED_EXTRA_RESOURCE)) {
    throw new Error("package.json build.extraResources must copy LICENSE to LICENSE");
  }
  if (!hasExtraResource(build.extraResources, EXPECTED_ICON_RESOURCE)) {
    throw new Error("package.json build.extraResources must copy assets/app_icon.ico to assets/app_icon.ico");
  }

  const releaseDir = resolveReleaseDir(absoluteRoot);
  const latestFields = parseYamlDocument(
    readRequiredFile(path.join(releaseDir, "latest.yml")),
    "latest.yml"
  );
  const appUpdateFields = parseYamlDocument(
    readRequiredFile(path.join(releaseDir, "win-unpacked", "resources", "app-update.yml")),
    "app-update.yml"
  );

  assertEqual(latestFields.version, version, "latest.yml version");
  assertEqual(appUpdateFields.provider, EXPECTED_PUBLISH.provider, "app-update.yml provider");
  assertEqual(appUpdateFields.owner, EXPECTED_PUBLISH.owner, "app-update.yml owner");
  assertEqual(appUpdateFields.repo, EXPECTED_PUBLISH.repo, "app-update.yml repo");

  const expectedSetup = `${EXPECTED_PRODUCT_NAME}-Setup-${version}.exe`;
  const expectedPortable = `${EXPECTED_PRODUCT_NAME}-${version}-portable.exe`;
  const expectedBlockmap = `${expectedSetup}.blockmap`;
  assertEqual(latestFields.path, expectedSetup, "latest.yml path");

  const requiredArtifacts = [expectedSetup, expectedPortable, expectedBlockmap];
  const missingArtifacts = requiredArtifacts.filter((fileName) => !fs.existsSync(path.join(releaseDir, fileName)));
  if (missingArtifacts.length > 0) {
    throw new Error(`Missing release artifacts: ${missingArtifacts.join(", ")}`);
  }
  const artifactStats = new Map();
  for (const fileName of requiredArtifacts) {
    artifactStats.set(fileName, requireNonEmptyFile(path.join(releaseDir, fileName), "release artifact"));
  }

  if (!Array.isArray(latestFields.files) || latestFields.files.length !== 1) {
    throw new Error("latest.yml files must contain exactly one canonical installer entry");
  }
  const installerEntry = latestFields.files[0];
  if (!installerEntry || typeof installerEntry !== "object" || Array.isArray(installerEntry)) {
    throw new Error("latest.yml files entry must be a mapping");
  }
  assertEqual(installerEntry.url, expectedSetup, "latest.yml files url");
  const expectedSetupSize = artifactStats.get(expectedSetup).size;
  assertEqual(installerEntry.size, expectedSetupSize, "latest.yml files size");
  const expectedSetupDigest = sha512Base64(path.join(releaseDir, expectedSetup));
  assertEqual(installerEntry.sha512, expectedSetupDigest, "latest.yml files SHA512 digest");
  assertEqual(latestFields.sha512, expectedSetupDigest, "latest.yml SHA512 digest");

  verifyRedistributionFiles(absoluteRoot, "sourcePath", "source");
  verifyRedistributionFiles(path.join(releaseDir, "win-unpacked"), "packagedPath", "win-unpacked");
  verifyPackagedIcon(absoluteRoot, path.join(releaseDir, "win-unpacked"), "win-unpacked");

  return {
    publish: {
      provider: publish.provider,
      owner: publish.owner,
      repo: publish.repo
    },
    latestArtifact: latestFields.path,
    missingArtifacts
  };
}

export function verifyReleaseArchives(rootDir = process.cwd(), options = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const { version } = readPackageVersion(absoluteRoot);
  const releaseDir = resolveReleaseDir(absoluteRoot);
  const sevenZipPath = String(options.sevenZipPath || process.env.SEVEN_ZIP_PATH || "7z").trim();
  const commandRunner = options.runCommand || runCommand;
  const archiveNames = [
    `${EXPECTED_PRODUCT_NAME}-Setup-${version}.exe`,
    `${EXPECTED_PRODUCT_NAME}-${version}-portable.exe`
  ];
  const verifiedArchives = [];

  for (const archiveName of archiveNames) {
    const archivePath = path.join(releaseDir, archiveName);
    requireNonEmptyFile(archivePath, "release archive");
    const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "public-release-archive-"));
    try {
      extractArchiveTree(archivePath, extractionRoot, sevenZipPath, commandRunner);
      verifyArchiveRedistributionFiles(extractionRoot, archiveName, absoluteRoot);
      verifiedArchives.push(archiveName);
    } finally {
      fs.rmSync(extractionRoot, { recursive: true, force: true });
    }
  }

  return { verifiedArchives };
}

function parseCliArgs(argv) {
  let rootDir = "";
  let verifyArchives = false;
  let sevenZipPath = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-archives") {
      verifyArchives = true;
    } else if (arg === "--seven-zip") {
      index += 1;
      sevenZipPath = String(argv[index] || "").trim();
      if (!sevenZipPath) {
        throw new Error("--seven-zip requires an executable path");
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (!rootDir) {
      rootDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (sevenZipPath && !verifyArchives) {
    throw new Error("--seven-zip requires --verify-archives");
  }
  return {
    rootDir: rootDir || process.cwd(),
    verifyArchives,
    sevenZipPath: sevenZipPath || process.env.SEVEN_ZIP_PATH || "7z"
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const result = verifyPublicRelease(args.rootDir);
    const archiveResult = args.verifyArchives
      ? verifyReleaseArchives(args.rootDir, { sevenZipPath: args.sevenZipPath })
      : { verifiedArchives: [] };
    process.stdout.write(`${JSON.stringify({ ...result, ...archiveResult })}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
