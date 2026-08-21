import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createPackage } from "@electron/asar";

type ReleaseVerification = {
  publish: {
    provider: string;
    owner: string;
    repo: string;
  };
  latestArtifact: string;
  missingArtifacts: string[];
};

type CommandResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

type ArchiveVerification = {
  verifiedArchives: string[];
};

const verifierPath = path.resolve("scripts", "verify_public_release.mjs");
const verifierUrl = "../scripts/verify_public_release.mjs";
const { verifyPublicRelease, verifyReleaseArchives } = await import(verifierUrl) as {
  verifyPublicRelease: (rootDir: string) => ReleaseVerification;
  verifyReleaseArchives: (
    rootDir: string,
    options: {
      sevenZipPath: string;
      runCommand: (command: string, args: string[]) => CommandResult;
    }
  ) => ArchiveVerification;
};
const fixtureRoots: string[] = [];
async function createFixtureAsar(version: string): Promise<Buffer> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-release-asar-"));
  const sourceDir = path.join(rootDir, "source");
  const outputPath = path.join(rootDir, "app.asar");
  fs.mkdirSync(path.join(sourceDir, "build", "main", "main"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "package.json"), JSON.stringify({ name: "multi-debrid-downloader", version }), "utf8");
  fs.writeFileSync(path.join(sourceDir, "build", "main", "main", "main.js"), `var package_default = { name: "multi-debrid-downloader", version: "${version}" };`, "utf8");
  await createPackage(sourceDir, outputPath);
  const payload = fs.readFileSync(outputPath);
  fs.rmSync(rootDir, { recursive: true, force: true });
  return payload;
}
const validAppAsar = await createFixtureAsar("1.7.233");
const staleAppAsar = await createFixtureAsar("1.7.232");
const redistributionFiles = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "resources/extractor-jvm/licenses/LGPL-2.1.txt",
  "resources/extractor-jvm/licenses/7-Zip-license.txt",
  "resources/extractor-jvm/licenses/Apache-2.0.txt",
  "resources/extractor-jvm/THIRD_PARTY_NOTICES.txt"
] as const;

function writeFile(rootDir: string, relativePath: string, content: string | Buffer): void {
  const filePath = path.join(rootDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeRedistributionFiles(rootDir: string, packaged = false): void {
  for (const relativePath of redistributionFiles) {
    const content = fs.readFileSync(path.resolve(...relativePath.split("/")));
    let targetPath: string = relativePath;
    if (packaged && relativePath === "LICENSE") {
      targetPath = "win-unpacked/resources/LICENSE";
    } else if (packaged && relativePath === "THIRD_PARTY_NOTICES.md") {
      targetPath = "win-unpacked/resources/THIRD_PARTY_NOTICES.md";
    } else if (packaged) {
      targetPath = `win-unpacked/resources/app.asar.unpacked/${relativePath}`;
    }
    writeFile(rootDir, targetPath, content);
  }
}

function writeArchivePayload(outputDir: string, omittedName = ""): void {
  for (const relativePath of redistributionFiles) {
    if (path.basename(relativePath) === omittedName) {
      continue;
    }
    const content = fs.readFileSync(path.resolve(...relativePath.split("/")));
    const targetPath = relativePath === "LICENSE"
      ? "resources/LICENSE"
      : relativePath === "THIRD_PARTY_NOTICES.md"
        ? "resources/THIRD_PARTY_NOTICES.md"
      : `resources/app.asar.unpacked/${relativePath}`;
    writeFile(outputDir, targetPath, content);
  }
  if (omittedName !== "app_icon.ico") {
    writeFile(outputDir, "resources/assets/app_icon.ico", "application-icon");
  }
}

function createArchiveCommandRunner(omittedName = "") {
  return (command: string, args: string[]): CommandResult => {
    const archivePath = args[1] || "";
    const outputArg = args.find((arg) => arg.startsWith("-o"));
    if (!outputArg) {
      return { status: 2, stderr: "missing output directory" };
    }
    const outputDir = outputArg.slice(2);
    if (archivePath.toLowerCase().endsWith(".exe")) {
      writeFile(outputDir, "payload/app-64.7z", "nested archive");
    } else if (archivePath.toLowerCase().endsWith(".7z")) {
      writeArchivePayload(outputDir, omittedName);
    }
    return { status: command ? 0 : 2, stdout: "ok", stderr: "" };
  };
}

function createReleaseFixture(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-release-metadata-"));
  fixtureRoots.push(rootDir);
  const setupPayload = Buffer.from("setup");
  const setupSha512 = crypto.createHash("sha512").update(setupPayload).digest("base64");

  writeFile(rootDir, "package.json", `${JSON.stringify({
    name: "multi-debrid-downloader",
    version: "1.7.233",
    build: {
      productName: "Multi-Debrid-Downloader",
      publish: {
        provider: "github",
        owner: "Sucukdeluxe",
        repo: "Multi-Debrid-Downloader"
      },
      files: [
        "build/main/**/*",
        "build/renderer/**/*",
        "resources/extractor-jvm/**/*",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "package.json"
      ],
      extraResources: [
        {
          from: "LICENSE",
          to: "LICENSE"
        },
        {
          from: "THIRD_PARTY_NOTICES.md",
          to: "THIRD_PARTY_NOTICES.md"
        },
        {
          from: "assets/app_icon.ico",
          to: "assets/app_icon.ico"
        }
      ],
      nsis: {
        artifactName: "${productName}-Setup-${version}.${ext}",
        include: "resources/installer.nsh",
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true
      },
      portable: {
        artifactName: "${productName}-${version}-portable.${ext}"
      }
    }
  }, null, 2)}\n`);
  writeFile(
    rootDir,
    "latest.yml",
    `version: 1.7.233\nfiles:\n  - url: Multi-Debrid-Downloader-Setup-1.7.233.exe\n    sha512: ${setupSha512}\n    size: ${setupPayload.length}\npath: Multi-Debrid-Downloader-Setup-1.7.233.exe\nsha512: ${setupSha512}\n`
  );
  writeFile(
    rootDir,
    "win-unpacked/resources/app-update.yml",
    "provider: github\nowner: Sucukdeluxe\nrepo: Multi-Debrid-Downloader\n"
  );
  writeFile(rootDir, "Multi-Debrid-Downloader-Setup-1.7.233.exe", setupPayload);
  writeFile(rootDir, "Multi-Debrid-Downloader-Setup-1.7.233.exe.blockmap", "blockmap");
  writeFile(rootDir, "Multi-Debrid-Downloader-1.7.233-portable.exe", "portable");
  writeRedistributionFiles(rootDir);
  writeRedistributionFiles(rootDir, true);
  writeFile(rootDir, "assets/app_icon.ico", "application-icon");
  writeFile(rootDir, "win-unpacked/resources/assets/app_icon.ico", "application-icon");
  writeFile(rootDir, "win-unpacked/resources/app.asar", validAppAsar);
  writeFile(rootDir, "resources/installer.nsh", "!macro customCheckAppRunning\n${isUpdated}\nFIND_PROCESS\ntaskkill /f /im\n!macroend\n");

  return rootDir;
}

afterEach(() => {
  for (const rootDir of fixtureRoots.splice(0)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("public release metadata", () => {
  it("accepts the canonical GitHub release metadata and artifacts", () => {
    const rootDir = createReleaseFixture();

    const result = verifyPublicRelease(rootDir);

    expect(result.publish).toEqual({
      provider: "github",
      owner: "Sucukdeluxe",
      repo: "Multi-Debrid-Downloader"
    });
    expect(result.latestArtifact).toBe("Multi-Debrid-Downloader-Setup-1.7.233.exe");
    expect(result.missingArtifacts).toEqual([]);
  });

  it("rejects a package configured for a different GitHub owner", () => {
    const rootDir = createReleaseFixture();
    const packagePath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.build.publish.owner = "DifferentOwner";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/owner/i);
  });

  it("rejects a latest.yml path whose artifact does not exist", () => {
    const rootDir = createReleaseFixture();
    fs.rmSync(path.join(rootDir, "Multi-Debrid-Downloader-Setup-1.7.233.exe"));

    expect(() => verifyPublicRelease(rootDir)).toThrow(/Multi-Debrid-Downloader-Setup-1\.7\.233\.exe/);
  });

  it("rejects syntactically invalid latest.yml", () => {
    const rootDir = createReleaseFixture();
    fs.writeFileSync(
      path.join(rootDir, "latest.yml"),
      "version: 1.7.233\nfiles: [\npath: Multi-Debrid-Downloader-Setup-1.7.233.exe\n"
    );

    expect(() => verifyPublicRelease(rootDir)).toThrow(/latest\.yml|yaml/i);
  });

  it("rejects a noncanonical files entry in latest.yml", () => {
    const rootDir = createReleaseFixture();
    const latestPath = path.join(rootDir, "latest.yml");
    const latest = fs.readFileSync(latestPath, "utf8").replace(
      "url: Multi-Debrid-Downloader-Setup-1.7.233.exe",
      "url: Different-Setup-1.7.233.exe"
    );
    fs.writeFileSync(latestPath, latest);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/files|url|canonical/i);
  });

  it("rejects a latest.yml SHA512 digest that does not match the installer", () => {
    const rootDir = createReleaseFixture();
    const latestPath = path.join(rootDir, "latest.yml");
    const latest = fs.readFileSync(latestPath, "utf8");
    const wrongDigest = Buffer.alloc(64, 0x23).toString("base64");
    fs.writeFileSync(latestPath, latest.replace(/sha512: [^\n]+/g, `sha512: ${wrongDigest}`));

    expect(() => verifyPublicRelease(rootDir)).toThrow(/sha512|digest|integrity/i);
  });

  it("rejects a directory in place of an artifact file", () => {
    const rootDir = createReleaseFixture();
    const setupPath = path.join(rootDir, "Multi-Debrid-Downloader-Setup-1.7.233.exe");
    fs.rmSync(setupPath);
    fs.mkdirSync(setupPath);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/artifact|file/i);
  });

  it("rejects an empty artifact file", () => {
    const rootDir = createReleaseFixture();
    fs.writeFileSync(path.join(rootDir, "Multi-Debrid-Downloader-1.7.233-portable.exe"), "");

    expect(() => verifyPublicRelease(rootDir)).toThrow(/artifact|empty|file/i);
  });

  it("rejects a release missing a declared redistribution license", () => {
    const rootDir = createReleaseFixture();
    fs.rmSync(path.join(rootDir, "resources", "extractor-jvm", "licenses", "Apache-2.0.txt"));

    expect(() => verifyPublicRelease(rootDir)).toThrow(/Apache-2\.0\.txt/);
  });

  it("rejects a modified official license text", () => {
    const rootDir = createReleaseFixture();
    fs.appendFileSync(
      path.join(rootDir, "resources", "extractor-jvm", "licenses", "LGPL-2.1.txt"),
      "modified"
    );

    expect(() => verifyPublicRelease(rootDir)).toThrow(/LGPL-2\.1\.txt|digest|content/i);
  });

  it("rejects swapped third-party license assignments", () => {
    const rootDir = createReleaseFixture();
    const noticePath = path.join(rootDir, "resources", "extractor-jvm", "THIRD_PARTY_NOTICES.txt");
    const notice = fs.readFileSync(noticePath, "utf8")
      .replace("GNU Lesser General Public License 2.1 or later", "Apache License 2.0")
      .replace("licenses/LGPL-2.1.txt; licenses/7-Zip-license.txt", "licenses/Apache-2.0.txt");
    fs.writeFileSync(noticePath, notice);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/THIRD_PARTY_NOTICES|notice|digest|mapping/i);
  });

  it("rejects a release whose unpacked application omits a license", () => {
    const rootDir = createReleaseFixture();
    fs.rmSync(path.join(
      rootDir,
      "win-unpacked",
      "resources",
      "app.asar.unpacked",
      "resources",
      "extractor-jvm",
      "licenses",
      "Apache-2.0.txt"
    ));

    expect(() => verifyPublicRelease(rootDir)).toThrow(/win-unpacked|Apache-2\.0\.txt|packaged/i);
  });

  it("rejects a symlink in place of a release artifact", () => {
    const rootDir = createReleaseFixture();
    const setupPath = path.join(rootDir, "Multi-Debrid-Downloader-Setup-1.7.233.exe");
    const targetPath = path.join(rootDir, "setup-target.exe");
    fs.renameSync(setupPath, targetPath);
    fs.symlinkSync(targetPath, setupPath, "file");

    expect(() => verifyPublicRelease(rootDir)).toThrow(/symbolic|symlink|regular file/i);
  });

  it("rejects a symlink in place of an official license", () => {
    const rootDir = createReleaseFixture();
    const licensePath = path.join(rootDir, "resources", "extractor-jvm", "licenses", "Apache-2.0.txt");
    const targetPath = path.join(rootDir, "Apache-target.txt");
    fs.renameSync(licensePath, targetPath);
    fs.symlinkSync(targetPath, licensePath, "file");

    expect(() => verifyPublicRelease(rootDir)).toThrow(/symbolic|symlink|regular file/i);
  });

  it("rejects build metadata that omits the project license", () => {
    const rootDir = createReleaseFixture();
    const packagePath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.build.files = packageJson.build.files.filter((entry: string) => entry !== "LICENSE");
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/LICENSE/);
  });

  it("rejects build metadata that does not copy the project license into resources", () => {
    const rootDir = createReleaseFixture();
    const packagePath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    delete packageJson.build.extraResources;
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/extraResources|LICENSE/);
  });

  it("rejects release metadata without the update-safe NSIS include", () => {
    const rootDir = createReleaseFixture();
    const packagePath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    delete packageJson.build.nsis.include;
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/NSIS|update|installer/i);
  });

  it("rejects a packaged main bundle built before the release version changed", () => {
    const rootDir = createReleaseFixture();
    fs.writeFileSync(path.join(rootDir, "win-unpacked", "resources", "app.asar"), staleAppAsar);

    expect(() => verifyPublicRelease(rootDir)).toThrow(/main bundle|version/i);
  });

  it("rejects a packaged application without its window and tray icon", () => {
    const rootDir = createReleaseFixture();
    fs.rmSync(path.join(rootDir, "win-unpacked", "resources", "assets", "app_icon.ico"));

    expect(() => verifyPublicRelease(rootDir)).toThrow(/app_icon|icon/i);
  });

  it("rejects incomplete third-party redistribution notices", () => {
    const rootDir = createReleaseFixture();
    fs.writeFileSync(
      path.join(rootDir, "resources", "extractor-jvm", "THIRD_PARTY_NOTICES.txt"),
      "net.sf.sevenzipjbinding:sevenzipjbinding:16.02-2.01 LGPL-2.1.txt\n"
    );

    expect(() => verifyPublicRelease(rootDir)).toThrow(/THIRD_PARTY_NOTICES|notice|content/i);
  });

  it("returns a nonzero CLI status for invalid release metadata", () => {
    const rootDir = createReleaseFixture();
    const packagePath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.build.publish.owner = "DifferentOwner";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const result = spawnSync(process.execPath, [verifierPath, rootDir], {
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/owner/i);
  });

  it("recursively verifies redistribution files inside setup and portable archives", () => {
    const rootDir = createReleaseFixture();
    const result = verifyReleaseArchives(rootDir, {
      sevenZipPath: "C:\\Tools\\7-Zip\\7z.exe",
      runCommand: createArchiveCommandRunner()
    });

    expect(result.verifiedArchives).toEqual([
      "Multi-Debrid-Downloader-Setup-1.7.233.exe",
      "Multi-Debrid-Downloader-1.7.233-portable.exe"
    ]);
  });

  it("rejects an archive whose nested application payload omits a license", () => {
    const rootDir = createReleaseFixture();

    expect(() => verifyReleaseArchives(rootDir, {
      sevenZipPath: "C:\\Tools\\7-Zip\\7z.exe",
      runCommand: createArchiveCommandRunner("Apache-2.0.txt")
    })).toThrow(/Apache-2\.0\.txt|missing redistribution file/i);
  });

  it("exposes archive verification as a nonzero CLI gate", () => {
    const rootDir = createReleaseFixture();
    const result = spawnSync(process.execPath, [
      verifierPath,
      rootDir,
      "--verify-archives",
      "--seven-zip",
      path.join(rootDir, "missing-7z.exe")
    ], {
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/7-Zip|command|spawn/i);
  });
});
