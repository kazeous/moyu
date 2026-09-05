import type {
  RequestedSubtitleEncoding,
  ResolvedSubtitleEncoding,
  SubtitleDecodeResult,
} from "./contracts";

const bomDefinitions = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
] as const;

const decoderLabels = {
  "utf-8": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  shift_jis: "shift_jis",
  gb18030: "gb18030",
  big5: "big5",
} as const;

type UnicodeBomEncoding = Extract<
  ResolvedSubtitleEncoding,
  "utf-8" | "utf-16le" | "utf-16be"
>;

export type UnicodeBom = Readonly<{
  encoding: UnicodeBomEncoding;
  byteLength: number;
}>;

export function detectUnicodeBom(bytes: Uint8Array): UnicodeBom | null {
  for (const definition of bomDefinitions) {
    if (definition.bytes.every((value, index) => bytes[index] === value)) {
      return {
        encoding: definition.encoding,
        byteLength: definition.bytes.length,
      };
    }
  }

  return null;
}

export function decodeSubtitleBytes(
  bytes: ArrayBuffer,
  requestedEncoding: RequestedSubtitleEncoding,
): SubtitleDecodeResult {
  const sourceBytes = new Uint8Array(bytes);
  const bom = detectUnicodeBom(sourceBytes);
  const encoding = bom?.encoding ?? requestedEncoding;

  try {
    const decoder = new TextDecoder(decoderLabels[encoding], { fatal: true });
    return {
      kind: "decoded",
      text: decoder.decode(sourceBytes),
      encoding,
      hadBom: bom !== null,
    };
  } catch {
    return {
      kind: "invalid-encoding",
      requested: requestedEncoding,
      reason: `The file is not valid ${requestedEncoding}.`,
    };
  }
}
