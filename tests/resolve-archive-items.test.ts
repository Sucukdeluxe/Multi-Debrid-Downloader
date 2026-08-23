import { describe, expect, it } from "vitest";
import {
  markPlannedHybridArchiveItemsPending,
  resolveArchiveItemsFromList,
  resolveSelectedArchiveSetsFromCandidates,
} from "../src/main/download-manager";

type MinimalItem = {
  targetPath?: string;
  fileName?: string;
  [key: string]: unknown;
};

function makeItems(names: string[]): MinimalItem[] {
  return names.map((name) => ({
    targetPath: `C:\\Downloads\\Package\\${name}`,
    fileName: name,
    id: name,
    status: "completed",
  }));
}

describe("resolveArchiveItemsFromList", () => {

  it("matches multipart .part1.rar archives", () => {
    const items = makeItems([
      "Movie.part1.rar",
      "Movie.part2.rar",
      "Movie.part3.rar",
      "Other.rar",
    ]);
    const result = resolveArchiveItemsFromList("Movie.part1.rar", items as any);
    expect(result).toHaveLength(3);
    expect(result.map((i: any) => i.fileName)).toEqual([
      "Movie.part1.rar",
      "Movie.part2.rar",
      "Movie.part3.rar",
    ]);
  });

  it("matches multipart .part01.rar archives (zero-padded)", () => {
    const items = makeItems([
      "Film.part01.rar",
      "Film.part02.rar",
      "Film.part10.rar",
      "Unrelated.zip",
    ]);
    const result = resolveArchiveItemsFromList("Film.part01.rar", items as any);
    expect(result).toHaveLength(3);
  });

  it("matches old-style .rar + .rNN volumes", () => {
    const items = makeItems([
      "Archive.rar",
      "Archive.r00",
      "Archive.r01",
      "Archive.r02",
      "Other.zip",
    ]);
    const result = resolveArchiveItemsFromList("Archive.rar", items as any);
    expect(result).toHaveLength(4);
  });

  it("matches a single .rar file", () => {
    const items = makeItems(["SingleFile.rar", "Other.mkv"]);
    const result = resolveArchiveItemsFromList("SingleFile.rar", items as any);
    expect(result).toHaveLength(1);
    expect((result[0] as any).fileName).toBe("SingleFile.rar");
  });

  it("matches split .zip.NNN files", () => {
    const items = makeItems([
      "Data.zip",
      "Data.zip.001",
      "Data.zip.002",
      "Data.zip.003",
    ]);
    const result = resolveArchiveItemsFromList("Data.zip.001", items as any);
    expect(result).toHaveLength(4);
  });

  it("matches split .7z.NNN files", () => {
    const items = makeItems([
      "Backup.7z.001",
      "Backup.7z.002",
    ]);
    const result = resolveArchiveItemsFromList("Backup.7z.001", items as any);
    expect(result).toHaveLength(2);
  });

  it("matches generic .NNN split files", () => {
    const items = makeItems([
      "video.001",
      "video.002",
      "video.003",
    ]);
    const result = resolveArchiveItemsFromList("video.001", items as any);
    expect(result).toHaveLength(3);
  });

  it("matches a single .zip by exact name", () => {
    const items = makeItems(["myarchive.zip", "other.rar"]);
    const result = resolveArchiveItemsFromList("myarchive.zip", items as any);
    expect(result).toHaveLength(1);
    expect((result[0] as any).fileName).toBe("myarchive.zip");
  });

  it("matches case-insensitively", () => {
    const items = makeItems([
      "MOVIE.PART1.RAR",
      "MOVIE.PART2.RAR",
    ]);
    const result = resolveArchiveItemsFromList("movie.part1.rar", items as any);
    expect(result).toHaveLength(2);
  });

  it("uses stem-based fallback when exact patterns fail", () => {
    const items = makeItems([
      "Movie.rar",
    ]);
    const result = resolveArchiveItemsFromList("Movie.part1.rar", items as any);
    expect(result).toHaveLength(1);
  });

  it("does not guess a different single archive when no pattern matches", () => {
    const items = makeItems(["totally-different-name.rar"]);
    const result = resolveArchiveItemsFromList("Original.rar", items as any);
    expect(result).toHaveLength(0);
  });

  it("returns empty when items have no archive extensions", () => {
    const items = makeItems(["video.mkv", "subtitle.srt"]);
    const result = resolveArchiveItemsFromList("Archive.rar", items as any);
    expect(result).toHaveLength(0);
  });

  it("falls back to fileName when targetPath is missing", () => {
    const items = [
      { fileName: "Movie.part1.rar", id: "1", status: "completed" },
      { fileName: "Movie.part2.rar", id: "2", status: "completed" },
    ];
    const result = resolveArchiveItemsFromList("Movie.part1.rar", items as any);
    expect(result).toHaveLength(2);
  });

  it("does not cross-match different archive groups", () => {
    const items = makeItems([
      "Episode.S01E01.part1.rar",
      "Episode.S01E01.part2.rar",
      "Episode.S01E02.part1.rar",
      "Episode.S01E02.part2.rar",
    ]);
    const result1 = resolveArchiveItemsFromList("Episode.S01E01.part1.rar", items as any);
    expect(result1).toHaveLength(2);
    expect(result1.every((i: any) => i.fileName.includes("S01E01"))).toBe(true);

    const result2 = resolveArchiveItemsFromList("Episode.S01E02.part1.rar", items as any);
    expect(result2).toHaveLength(2);
    expect(result2.every((i: any) => i.fileName.includes("S01E02"))).toBe(true);
  });

  it("resolves every multipart volume beside the selected non-first part without crossing directories", () => {
    const items = [
      {
        targetPath: "C:\\Downloads\\Package\\Disc A\\Movie.part1.rar",
        fileName: "Movie.part1.rar",
        id: "disc-a-part-1",
        status: "completed",
      },
      {
        targetPath: "C:\\Downloads\\Package\\Disc A\\Movie.part2.rar",
        fileName: "Movie.part2.rar",
        id: "disc-a-part-2",
        status: "completed",
      },
      {
        targetPath: "C:\\Downloads\\Package\\Disc B\\Movie.part1.rar",
        fileName: "Movie.part1.rar",
        id: "disc-b-part-1",
        status: "completed",
      },
      {
        targetPath: "C:\\Downloads\\Package\\Disc B\\Movie.part2.rar",
        fileName: "Movie.part2.rar",
        id: "disc-b-part-2",
        status: "completed",
      },
    ];

    const result = resolveArchiveItemsFromList(
      "Movie.part2.rar",
      items as any,
      "C:\\Downloads\\Package\\Disc A\\Movie.part2.rar"
    );

    expect(result.map((item: any) => item.id)).toEqual([
      "disc-a-part-1",
      "disc-a-part-2",
    ]);
  });
});

describe("resolveSelectedArchiveSetsFromCandidates", () => {
  it("maps a selected non-first part to its canonical archive and complete multipart set", () => {
    const items = [
      { id: "e01-1", fileName: "Episode.E01.part1.rar", targetPath: "C:\\Downloads\\Episode.E01.part1.rar", status: "completed" },
      { id: "e01-2", fileName: "Episode.E01.part2.rar", targetPath: "C:\\Downloads\\Episode.E01.part2.rar", status: "completed" },
      { id: "e02-1", fileName: "Episode.E02.part1.rar", targetPath: "C:\\Downloads\\Episode.E02.part1.rar", status: "completed" },
      { id: "e02-2", fileName: "Episode.E02.part2.rar", targetPath: "C:\\Downloads\\Episode.E02.part2.rar", status: "completed" }
    ];
    const selected = resolveSelectedArchiveSetsFromCandidates(
      ["C:\\Downloads\\Episode.E01.part1.rar", "C:\\Downloads\\Episode.E02.part1.rar"],
      items as any,
      new Set(["e01-2"])
    );

    expect([...selected.archivePaths]).toEqual(["C:\\Downloads\\Episode.E01.part1.rar"]);
    expect([...selected.itemIds].sort()).toEqual(["e01-1", "e01-2"]);
  });

  it("resolves a uniquely matching pathless legacy item", () => {
    const selected = resolveSelectedArchiveSetsFromCandidates(
      ["C:\\Downloads\\Episode.E01.rar"],
      [{ id: "legacy", fileName: "Episode.E01.rar", targetPath: "", status: "completed" }] as any,
      new Set(["legacy"])
    );

    expect([...selected.archivePaths]).toEqual(["C:\\Downloads\\Episode.E01.rar"]);
    expect([...selected.itemIds]).toEqual(["legacy"]);
  });
});

describe("markPlannedHybridArchiveItemsPending", () => {
  it("keeps unplanned incomplete archive groups waiting", () => {
    const items = [
      {
        id: "planned-part-1",
        status: "completed",
        fullStatus: "Entpacken - Warten auf Parts",
        updatedAt: 1,
      },
      {
        id: "foreign-part-1",
        status: "completed",
        fullStatus: "Entpacken - Warten auf Parts",
        updatedAt: 2,
      },
    ];

    const changed = markPlannedHybridArchiveItemsPending(
      items as any,
      new Set(["planned-part-1"]),
      100
    );

    expect(changed).toBe(true);
    expect(items).toEqual([
      {
        id: "planned-part-1",
        status: "completed",
        fullStatus: "Entpacken - Ausstehend",
        updatedAt: 100,
      },
      {
        id: "foreign-part-1",
        status: "completed",
        fullStatus: "Entpacken - Warten auf Parts",
        updatedAt: 2,
      },
    ]);
  });
});
