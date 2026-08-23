import { describe, expect, it } from "vitest";
import type { DownloadItem, PackageEntry } from "../src/shared/types";
import type { DownloadPackageRow } from "../src/renderer/views/downloads/downloads-model";
import { buildPackagePresentation } from "../src/renderer/views/downloads/package-presentation";

function item(id: string, fullStatus: string, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    packageId: "pkg",
    url: `https://example.invalid/${id}`,
    provider: "realdebrid",
    status: "completed",
    retries: 0,
    speedBps: 0,
    downloadedBytes: 100,
    totalBytes: 100,
    progressPercent: 100,
    fileName: `${id}.rar`,
    targetPath: `C:\\Downloads\\${id}.rar`,
    resumable: true,
    attempts: 0,
    lastError: "",
    fullStatus,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function row(items: DownloadItem[], overrides: Partial<PackageEntry> = {}): DownloadPackageRow {
  const entry = {
    id: "pkg",
    name: "Paket",
    outputDir: "C:\\Downloads\\Paket",
    extractDir: "C:\\Downloads\\_entpackt\\Paket",
    itemIds: items.map((entry) => entry.id),
    enabled: true,
    cancelled: false,
    status: "completed",
    priority: "normal",
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } as PackageEntry;
  return { package: entry, items, allItems: items, collapsed: true };
}

describe("download package presentation", () => {
  it("reserves 90 percent for completed downloads and 10 percent for extraction", () => {
    expect(buildPackagePresentation(row([
      item("a", "Entpack-Fehler: Passwort"),
      item("b", "Entpack-Fehler: CRC")
    ])).progress.value).toBe(90);

    expect(buildPackagePresentation(row([
      item("a", "Entpackt in 4s"),
      item("b", "Entpack-Fehler: CRC")
    ])).progress.value).toBe(95);

    expect(buildPackagePresentation(row([
      item("a", "Entpackt in 4s"),
      item("b", "Entpackt in 5s")
    ])).progress.value).toBe(100);
  });

  it("keeps ordinary completed downloads at 100 percent when no extraction phase exists", () => {
    const presentation = buildPackagePresentation(row([
      item("a", "Fertig"),
      item("b", "Fertig")
    ]));
    expect(presentation.progress.value).toBe(100);
    expect(presentation.status).toBe("Fertig");
  });

  it("does not move backwards when an archive download enters extraction", () => {
    const active = item("archive", "Download läuft", {
      status: "downloading",
      downloadedBytes: 99,
      progressPercent: 99
    });
    const before = buildPackagePresentation(row([active], { status: "downloading" }));
    const after = buildPackagePresentation(row([{ ...active, status: "completed", downloadedBytes: 100, progressPercent: 100, fullStatus: "Entpacken - Ausstehend" }], { status: "extracting" }));

    expect(before.progress.value).toBe(89);
    expect(after.progress.value).toBe(90);
  });

  it("includes finalization progress in the reserved extraction range", () => {
    const presentation = buildPackagePresentation(row([
      item("archive", "Finalisieren - 99% · release.part01.rar")
    ], { status: "extracting", postProcessLabel: "Finalisieren - 99% (0/1) · release.part01.rar" }));

    expect(presentation.progress.value).toBe(99);
    expect(presentation.status).toBe("Finalisieren - 99% (0/1) · release.part01.rar");
  });

  it("shows the active CRC check instead of a completed fraction", () => {
    const presentation = buildPackagePresentation(row([
      item("archive", "CRC-Check läuft", { status: "integrity_check" })
    ], { status: "downloading" }));

    expect(presentation.status).toBe("CRC-Check läuft");
  });

  it("keeps an active CRC check ahead of historical sibling extraction errors", () => {
    const presentation = buildPackagePresentation(row([
      item("failed", "Entpack-Fehler [old.part01.rar]: Checksum/CRC-Fehler im Archiv"),
      item("active", "CRC-Check läuft", { status: "integrity_check" })
    ], { status: "downloading" }));

    expect(presentation.status).toBe("CRC-Check läuft");
    expect(presentation.details).toContain("1 Entpackfehler");
  });

  it.each([
    ["extracting", "Archive stabilisieren..."],
    ["extracting", "Entpacken vorbereiten..."],
    ["queued", "Entpacken wird neu gestartet..."],
    ["completed", "Nested Entpacken..."],
    ["completed", "Renaming..."],
    ["completed", "Tonspur..."],
    ["completed", "Aufräumen..."],
    ["completed", "Verschiebe Videos..."]
  ] as const)("keeps the active package phase %s / %s ahead of historical sibling errors", (packageStatus, postProcessLabel) => {
    const presentation = buildPackagePresentation(row([
      item("failed", "Entpack-Fehler [old.part01.rar]: Checksum/CRC-Fehler im Archiv"),
      item("active", "Fertig")
    ], { status: packageStatus, postProcessLabel }));

    expect(presentation.status).toBe(postProcessLabel);
    expect(presentation.details).toContain("1 Entpackfehler");
    expect(presentation.extractFailure?.id).toBe("failed");
  });

  it("keeps a running download ahead of historical sibling extraction errors", () => {
    const presentation = buildPackagePresentation(row([
      item("failed", "Entpack-Fehler [old.part01.rar]: Checksum/CRC-Fehler im Archiv"),
      item("active", "Download läuft", { status: "downloading", downloadedBytes: 50, progressPercent: 50 })
    ], { status: "downloading" }));

    expect(presentation.status).toBe("Download läuft");
    expect(presentation.details).toContain("1 Entpackfehler");
  });

  it.each([
    "Entpacken - Ausstehend",
    "Entpacken - Warten auf Parts"
  ])("keeps a running download ahead of the sibling state %s", (fullStatus) => {
    const presentation = buildPackagePresentation(row([
      item("pending", fullStatus),
      item("active", "Download läuft", { status: "downloading", downloadedBytes: 50, progressPercent: 50 })
    ], { status: "downloading" }));

    expect(presentation.status).toBe("Download läuft");
  });

  it.each([
    ["queued", "Entpacken - Ausstehend", "Entpacken - Ausstehend"],
    ["extracting", "Entpacken - Ausstehend", "Entpacken - Ausstehend"],
    ["queued", "Entpacken - Warten auf Parts", "Entpacken - Warten auf Parts"],
    ["extracting", "Entpacken - Warten auf Parts", "Entpacken - Warten auf Parts"]
  ] as const)("keeps the pending extraction state %s / %s visible on the package", (packageStatus, fullStatus, expectedStatus) => {
    const presentation = buildPackagePresentation(row([
      item("archive", fullStatus)
    ], { status: packageStatus }));

    expect(presentation.status).toBe(expectedStatus);
  });

  it.each([
    "Entpacken 42% (1/1) · release.part01.rar",
    "Passwort knacken: 50% (2/4)",
    "Finalisieren - 99% (0/1) · release.part01.rar"
  ])("keeps the active extraction phase %s ahead of historical sibling errors", (postProcessLabel) => {
    const presentation = buildPackagePresentation(row([
      item("failed", "Entpack-Fehler [old.part01.rar]: Checksum/CRC-Fehler im Archiv"),
      item("active", postProcessLabel)
    ], { status: "extracting", postProcessLabel }));

    expect(presentation.status).toBe(postProcessLabel);
    expect(presentation.details).toContain("1 Entpackfehler");
    expect(presentation.extractFailure?.id).toBe("failed");
  });

  it("keeps the active disk wait ahead of historical sibling errors", () => {
    const presentation = buildPackagePresentation(row([
      item("failed", "Entpack-Fehler [old.part01.rar]: Checksum/CRC-Fehler im Archiv"),
      item("active", "Warte auf Festplatte")
    ], { status: "queued" }));

    expect(presentation.status).toBe("Warte auf Festplatte");
    expect(presentation.details).toContain("1 Entpackfehler");
  });

  it("summarizes mixed extraction errors and a live retry instead of showing a fraction", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, index) => item(`failed-${index}`, "Entpack-Fehler: Keine entpackten Dateien erkannt")),
      item("retry", "Link-Umwandlung erneut, Versuch 6/...", {
        status: "validating",
        retries: 6,
        downloadedBytes: 0,
        progressPercent: 0
      })
    ];
    const presentation = buildPackagePresentation(row(items, { status: "queued" }));

    expect(presentation.status).toBe("7 Entpackfehler · Link-Umwandlung erneut");
    expect(presentation.details).toContain("7 Entpackfehler");
    expect(presentation.details).toContain("Link-Umwandlung erneut");
  });

  it("describes parallel link conversion retries without presenting the item count as attempts", () => {
    const retries = Array.from({ length: 20 }, (_, index) => item(`retry-${index}`, "Link-Umwandlung erneut, Versuch 2/...", {
      status: "validating",
      retries: 2,
      downloadedBytes: 0,
      progressPercent: 0
    }));

    const presentation = buildPackagePresentation(row(retries, { status: "queued" }));

    expect(presentation.status).toBe("Link-Umwandlung erneut");
    expect(presentation.status).not.toContain("20");
  });

  it("keeps a single normal active download compact", () => {
    const presentation = buildPackagePresentation(row([
      item("active", "Download läuft", {
        status: "downloading",
        downloadedBytes: 50,
        progressPercent: 50
      })
    ], { status: "downloading" }));

    expect(presentation.status).toBe("Download läuft");
  });
});
