import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const output = path.resolve("public/ocr/v1");
const sources = [];
async function copy(packageName, version, file, target, license) {
  const root = path.dirname(require.resolve(`${packageName}/package.json`));
  const metadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (metadata.version !== version)
    throw new Error(`OCR asset version mismatch: ${packageName}`);
  const bytes = await readFile(path.join(root, file));
  const destination = path.join(output, target);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file), destination);
  sources.push({
    package: packageName,
    version,
    sourceFile: file,
    path: `/ocr/v1/${target}`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    license,
  });
}
await copy(
  "tesseract.js",
  "6.0.1",
  "dist/worker.min.js",
  "worker.min.js",
  "Apache-2.0",
);
await copy(
  "tesseract.js",
  "6.0.1",
  "LICENSE.md",
  "TESSERACT-JS-LICENSE.txt",
  "Apache-2.0",
);
await copy(
  "tesseract.js-core",
  "6.0.0",
  "LICENSE",
  "TESSERACT-CORE-LICENSE.txt",
  "Apache-2.0",
);
for (const variant of ["", "-simd", "-lstm", "-simd-lstm"]) {
  const name = `tesseract-core${variant}.wasm.js`;
  await copy("tesseract.js-core", "6.0.0", name, `core/${name}`, "Apache-2.0");
}
for (const language of ["jpn", "chi_sim", "chi_tra"]) {
  await copy(
    `@tesseract.js-data/${language}`,
    "1.0.0",
    `4.0.0_best_int/${language}.traineddata.gz`,
    `lang/${language}.traineddata.gz`,
    "Apache-2.0 (Tesseract data); MIT (npm packaging)",
  );
}
const register = {
  version: 1,
  attribution:
    "Tesseract OCR contributors; Tesseract.js contributors; language packages by Balearica and Jerome Wu. Integerized tessdata_best models, unmodified gzip files.",
  upstream: [
    "https://github.com/naptha/tesseract.js",
    "https://github.com/naptha/tesseract.js-core",
    "https://github.com/naptha/tessdata",
    "https://github.com/tesseract-ocr/tessdata_best",
  ],
  redistribution:
    "Apache-2.0 permits redistribution with license and attribution. Application code is separate. Retain the supplied notices. No upstream fixed update interval; review on dependency updates and regenerate this register.",
  sources,
};
const registerPath = "scripts/ocr-sources.lock.json";
if (process.argv.includes("--record")) {
  await writeFile(registerPath, `${JSON.stringify(register, null, 2)}\n`);
} else {
  const expected = JSON.parse(await readFile(registerPath, "utf8"));
  if (JSON.stringify(register) !== JSON.stringify(expected)) {
    throw new Error(
      "OCR source register mismatch. Review the dependency change before recording new assets.",
    );
  }
}
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(register, null, 2)}\n`,
);
process.stdout.write(`Prepared ${sources.length} pinned local OCR assets.\n`);
