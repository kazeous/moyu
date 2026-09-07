import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const staticRoot = path.resolve(".next/static");
const files = await readdir(staticRoot, {
  recursive: true,
  withFileTypes: true,
});
const assets = files
  .filter((file) => file.isFile() && /\.(js|css|woff2?|ttf)$/u.test(file.name))
  .map(
    (file) =>
      `/_next/static/${path.relative(staticRoot, path.join(file.parentPath, file.name)).replaceAll("\\", "/")}`,
  );
const version = (await readFile(".next/BUILD_ID", "utf8")).trim();
const ocr = JSON.parse(await readFile("public/ocr/v1/manifest.json", "utf8"));
await copyFile(".next/server/app/workspace.html", "public/offline.html");
const header = `globalThis.__MOYU_VERSION = ${JSON.stringify(version)};\nglobalThis.__MOYU_PRECACHE = ${JSON.stringify(["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", ...assets])};\nglobalThis.__MOYU_OCR = ${JSON.stringify(ocr.sources.map((source) => source.path))};\n`;
await writeFile(
  "public/sw.js",
  header + (await readFile("src/client/pwa/service-worker.js", "utf8")),
);
process.stdout.write(
  `Prepared offline workspace with ${assets.length} public build assets.\n`,
);
