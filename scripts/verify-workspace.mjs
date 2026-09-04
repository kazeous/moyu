import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { assertMetadataContracts } from "./verify-foundation.mjs";

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const networkConstructors = new Set([
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
]);
const forbiddenReviewContentKeys = new Set([
  "dialogue",
  "translation",
  "image",
  "ocrText",
  "analysis",
  "tokenization",
  "lookupResults",
  "selectionHistory",
]);

function scriptKindFor(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function importsFrom(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function normalizeSpecifier(specifier) {
  return specifier.replaceAll("\\", "/");
}

function isWorkspaceModule(specifier) {
  const normalized = normalizeSpecifier(specifier);
  return (
    normalized === "@/client/workspace" ||
    normalized.startsWith("@/client/workspace/") ||
    /(^|\/)client\/workspace($|\/)/u.test(normalized)
  );
}

function isServerModule(specifier) {
  const normalized = normalizeSpecifier(specifier);
  return (
    normalized === "@/server" ||
    normalized.startsWith("@/server/") ||
    /(^|\/)server($|\/)/u.test(normalized)
  );
}

function isUncheckedClientModule(sourcePath, specifier) {
  const normalized = normalizeSpecifier(specifier);
  if (normalized.startsWith("@/client/")) {
    return !isWorkspaceModule(normalized);
  }
  if (!normalized.startsWith(".")) {
    return false;
  }

  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), normalized),
  );
  return (
    resolved.startsWith("src/client/") &&
    !resolved.startsWith("src/client/workspace/")
  );
}

function findNetworkPrimitive(sourceFile) {
  let found;

  function visit(node) {
    if (found) return;

    const expressionName = (expression) => {
      if (ts.isIdentifier(expression)) return expression.text;
      if (ts.isPropertyAccessExpression(expression)) {
        return expression.name.text;
      }
      if (
        ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        ts.isStringLiteralLike(expression.argumentExpression)
      ) {
        return expression.argumentExpression.text;
      }
      return undefined;
    };

    if (
      ts.isCallExpression(node) &&
      expressionName(node.expression) === "fetch"
    ) {
      found = "fetch";
      return;
    }

    if (
      ts.isCallExpression(node) &&
      expressionName(node.expression) === "sendBeacon"
    ) {
      found = "sendBeacon";
      return;
    }

    if (
      ts.isNewExpression(node) &&
      expressionName(node.expression) &&
      networkConstructors.has(expressionName(node.expression))
    ) {
      found = expressionName(node.expression);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findForbiddenReviewContentKey(sourceFile) {
  let found;

  function propertyName(node) {
    const name = ts.isBindingElement(node)
      ? (node.propertyName ?? node.name)
      : node.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
      return name.text;
    }
    return undefined;
  }

  function visit(node) {
    if (found) return;

    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodSignature(node) ||
        ts.isBindingElement(node)) &&
      forbiddenReviewContentKeys.has(propertyName(node))
    ) {
      found = propertyName(node);
      return;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      forbiddenReviewContentKeys.has(node.name.text)
    ) {
      found = node.name.text;
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      forbiddenReviewContentKeys.has(node.argumentExpression.text)
    ) {
      found = node.argumentExpression.text;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function containsServerActionDirective(sourceFile) {
  let found = false;

  function visit(node) {
    if (found) return;
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use server"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * @param {{
 *   apiSources?: Array<{ path: string, text: string}>,
 *   appSources?: Array<{ path: string, text: string}>,
 *   clientSources?: Array<{ path: string, text: string }>,
 *   serverSources?: Array<{ path: string, text: string }>
 * }} sources
 */
export function inspectWorkspaceBoundary({
  apiSources = [],
  appSources = [],
  clientSources = [],
  serverSources = [],
} = {}) {
  for (const source of serverSources) {
    const parsed = ts.createSourceFile(
      source.path,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(source.path),
    );
    if (importsFrom(parsed).some(isWorkspaceModule)) {
      throw new Error(
        `Server code imports browser workspace data: ${source.path}`,
      );
    }
    if (containsServerActionDirective(parsed)) {
      const forbiddenKey = findForbiddenReviewContentKey(parsed);
      if (forbiddenKey) {
        throw new Error(
          `Server/API boundary introduces forbidden review-content key ${forbiddenKey}: ${source.path}`,
        );
      }
    }
  }

  for (const source of apiSources) {
    const parsed = ts.createSourceFile(
      source.path,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(source.path),
    );
    if (importsFrom(parsed).some(isWorkspaceModule)) {
      throw new Error(
        `Server code imports browser workspace data: ${source.path}`,
      );
    }
    const forbiddenKey = findForbiddenReviewContentKey(parsed);
    if (forbiddenKey) {
      throw new Error(
        `Server/API boundary introduces forbidden review-content key ${forbiddenKey}: ${source.path}`,
      );
    }
  }

  for (const source of appSources) {
    const parsed = ts.createSourceFile(
      source.path,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(source.path),
    );
    if (!containsServerActionDirective(parsed)) {
      continue;
    }
    if (importsFrom(parsed).some(isWorkspaceModule)) {
      throw new Error(
        `Server code imports browser workspace data: ${source.path}`,
      );
    }
    const forbiddenKey = findForbiddenReviewContentKey(parsed);
    if (forbiddenKey) {
      throw new Error(
        `Server/API boundary introduces forbidden review-content key ${forbiddenKey}: ${source.path}`,
      );
    }
  }

  for (const source of clientSources) {
    const parsed = ts.createSourceFile(
      source.path,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(source.path),
    );
    const imports = importsFrom(parsed);
    if (imports.some(isServerModule)) {
      throw new Error(`Browser workspace imports server code: ${source.path}`);
    }
    const uncheckedClientImport = imports.find((specifier) =>
      isUncheckedClientModule(source.path, specifier),
    );
    if (uncheckedClientImport) {
      throw new Error(
        `Browser workspace imports unchecked client module ${uncheckedClientImport}: ${source.path}`,
      );
    }
    const primitive = findNetworkPrimitive(parsed);
    if (primitive) {
      throw new Error(
        `Browser workspace uses network primitive ${primitive}: ${source.path}`,
      );
    }
  }

  return {
    apiFiles: apiSources.length,
    appFiles: appSources.length,
    clientFiles: clientSources.length,
    serverFiles: serverSources.length,
  };
}

async function readSources(root, directory) {
  const absoluteDirectory = path.join(root, directory);
  const entries = await readdir(absoluteDirectory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && sourceExtensions.has(path.extname(entry.name)),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  return Promise.all(
    files.map(async (filePath) => ({
      path: path.relative(root, filePath).replaceAll("\\", "/"),
      text: await readFile(filePath, "utf8"),
    })),
  );
}

export async function runWorkspaceVerification() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const [clientSources, serverSources, apiSources, appSources] =
    await Promise.all([
      readSources(projectRoot, "src/client/workspace"),
      readSources(projectRoot, "src/server"),
      readSources(projectRoot, "src/app/api"),
      readSources(projectRoot, "src/app"),
    ]);

  const result = inspectWorkspaceBoundary({
    apiSources,
    appSources: appSources.filter(
      (source) => !source.path.startsWith("src/app/api/"),
    ),
    clientSources,
    serverSources,
  });
  assertMetadataContracts();
  process.stdout.write(
    `Workspace privacy boundary passed (${result.clientFiles} browser files, ${result.serverFiles} server files, ${result.apiFiles} API files, ${result.appFiles} application files checked for server actions).\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runWorkspaceVerification();
  } catch (error) {
    process.stderr.write(
      `Workspace verification failed: ${error instanceof Error ? error.message : "Unknown verification error"}\n`,
    );
    process.exitCode = 1;
  }
}
