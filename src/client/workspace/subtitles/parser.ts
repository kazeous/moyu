import type { SubtitleFormat, SubtitleParseResult } from "./contracts";
import { parseAss } from "./ass-parser";
import { parseSrt } from "./srt-parser";

export function parseSubtitle(input: {
  artifactId: string;
  format: SubtitleFormat;
  text: string;
}): SubtitleParseResult {
  return input.format === "srt" ? parseSrt(input) : parseAss(input);
}
