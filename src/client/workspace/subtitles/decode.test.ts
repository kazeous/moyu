import { describe, expect, it } from "vitest";
import { decodeSubtitleBytes, detectUnicodeBom } from "./decode";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("detectUnicodeBom", () => {
  it.each([
    [[0xef, 0xbb, 0xbf], "utf-8", 3],
    [[0xff, 0xfe], "utf-16le", 2],
    [[0xfe, 0xff], "utf-16be", 2],
  ] as const)("detects the %s BOM", (signature, encoding, byteLength) => {
    expect(detectUnicodeBom(new Uint8Array(signature))).toEqual({
      encoding,
      byteLength,
    });
  });

  it("returns null when no Unicode BOM is present", () => {
    expect(detectUnicodeBom(new Uint8Array([0x41, 0x42]))).toBeNull();
  });
});

describe("decodeSubtitleBytes", () => {
  it("lets a UTF-16LE BOM override the default UTF-8 selection", () => {
    expect(decodeSubtitleBytes(bytes(0xff, 0xfe, 0x41, 0x00), "utf-8")).toEqual(
      {
        kind: "decoded",
        text: "A",
        encoding: "utf-16le",
        hadBom: true,
      },
    );
  });

  it("decodes a UTF-8 BOM and strips it from the text", () => {
    expect(decodeSubtitleBytes(bytes(0xef, 0xbb, 0xbf, 0x41), "utf-8")).toEqual(
      {
        kind: "decoded",
        text: "A",
        encoding: "utf-8",
        hadBom: true,
      },
    );
  });

  it("lets a UTF-16BE BOM override the default UTF-8 selection", () => {
    expect(decodeSubtitleBytes(bytes(0xfe, 0xff, 0x00, 0x41), "utf-8")).toEqual(
      {
        kind: "decoded",
        text: "A",
        encoding: "utf-16be",
        hadBom: true,
      },
    );
  });

  it("uses fatal UTF-8 and never inserts a replacement character", () => {
    const result = decodeSubtitleBytes(bytes(0x83, 0x65), "utf-8");
    expect(result).toMatchObject({
      kind: "invalid-encoding",
      requested: "utf-8",
    });
    expect(JSON.stringify(result)).not.toContain("�");
  });

  it("decodes an explicit Shift-JIS retry", () => {
    expect(
      decodeSubtitleBytes(
        bytes(0x83, 0x65, 0x83, 0x58, 0x83, 0x67),
        "shift_jis",
      ),
    ).toMatchObject({ kind: "decoded", text: "テスト", encoding: "shift_jis" });
  });

  it.each(["gb18030", "big5"] as const)(
    "returns an explicit result for %s without falling back",
    (encoding) => {
      const result = decodeSubtitleBytes(bytes(0xff), encoding);
      expect(["decoded", "invalid-encoding"]).toContain(result.kind);
      if (result.kind === "decoded") expect(result.encoding).toBe(encoding);
    },
  );
});
