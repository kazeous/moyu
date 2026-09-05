export const ASS_SOURCE = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,玲奈,0,0,0,,{\\i1}我已經等了很久{\\i0}
Dialogue: 0,0:00:04.00,0:00:06.00,Default,技師,0,0,0,,這是第一架機體`;

export const SRT_REFERENCE = `1
00:00:01,100 --> 00:00:03,000
Tôi đã đợi rất lâu rồi.

2
00:00:04,000 --> 00:00:06,100
Đây là cỗ máy đầu tiên.`;

export function subtitleFile(name: string, text: string) {
  return { name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") };
}

export const SHIFT_JIS_TEST_SRT = Buffer.from([
  0x31, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30,
  0x30, 0x20, 0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30,
  0x32, 0x2c, 0x30, 0x30, 0x30, 0x0a, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
]);
