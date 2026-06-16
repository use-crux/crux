import { createRequire as __crux_createRequire } from "node:module"; import { fileURLToPath as __crux_fileURLToPath } from "node:url"; import { dirname as __crux_dirname } from "node:path"; const require = __crux_createRequire(import.meta.url); const __filename = __crux_fileURLToPath(import.meta.url); const __dirname = __crux_dirname(__filename);

// bin/source-resolver.ts
import { createInterface } from "node:readline";

// ../indexer/source-resolver/cache.ts
var MAX_LOCATION_CACHE = 5e3;
function locationCacheKey(file, line, column) {
  return `${file}:${line}:${column ?? 0}`;
}
function putLocationCache(cache, key, value, limit = MAX_LOCATION_CACHE) {
  const next = new Map(cache);
  if (next.size >= limit && !next.has(key)) {
    const firstKey = next.keys().next().value;
    if (firstKey !== void 0) next.delete(firstKey);
  }
  next.set(key, value);
  return next;
}

// ../indexer/source-resolver/discovery.ts
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
function normalizePath(filePath) {
  if (!filePath.startsWith("file://")) return filePath;
  try {
    return fileURLToPath(filePath);
  } catch {
    return filePath.replace(/^file:\/\//, "");
  }
}
async function discoverSourceMap(bundledFile, fileSystem) {
  const sidecarPath = `${bundledFile}.map`;
  if (fileSystem.exists(sidecarPath)) {
    try {
      return { kind: "found", mapJson: await fileSystem.readFile(sidecarPath), source: "sidecar" };
    } catch {
      return { kind: "not-found", reason: "relative-map-not-readable" };
    }
  }
  let bundleContent;
  try {
    bundleContent = await fileSystem.readFile(bundledFile);
  } catch {
    return { kind: "not-found", reason: "bundle-not-readable" };
  }
  const tail = bundleContent.slice(-2e3);
  const match = tail.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m);
  if (!match) return { kind: "not-found", reason: "mapping-url-missing" };
  const url = match[1]?.trim() ?? "";
  if (url.startsWith("data:")) {
    const base64Match = url.match(/;base64,(.+)/);
    if (!base64Match) return { kind: "not-found", reason: "inline-map-invalid" };
    try {
      return {
        kind: "found",
        mapJson: Buffer.from(base64Match[1] ?? "", "base64").toString("utf-8"),
        source: "inline"
      };
    } catch {
      return { kind: "not-found", reason: "inline-map-invalid" };
    }
  }
  const mapPath = resolvePath(dirname(bundledFile), url);
  if (!fileSystem.exists(mapPath)) return { kind: "not-found", reason: "relative-map-not-readable" };
  try {
    return { kind: "found", mapJson: await fileSystem.readFile(mapPath), source: "relative-url" };
  } catch {
    return { kind: "not-found", reason: "relative-map-not-readable" };
  }
}

// ../indexer/source-resolver/extraction.ts
var MAX_FN_EXTRACT_LINES = 200;
function extractFunctionBody(source, startLine, startColumn, maxLines = MAX_FN_EXTRACT_LINES) {
  const lines = source.split("\n");
  if (startLine < 1 || startLine > lines.length) return null;
  const lineIdx = startLine - 1;
  const result = [];
  let depth = 0;
  let inString = null;
  let inTemplate = false;
  let templateDepth = 0;
  let started = false;
  for (let i = lineIdx; i < lines.length && i < lineIdx + maxLines; i++) {
    const currentLine = lines[i] ?? "";
    result.push(currentLine);
    for (let j = i === lineIdx ? startColumn : 0; j < currentLine.length; j++) {
      const ch = currentLine[j] ?? "";
      const prev = j > 0 ? currentLine[j - 1] ?? "" : "";
      if (prev === "\\") continue;
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (inTemplate) {
        if (ch === "`") {
          inTemplate = false;
          continue;
        }
        if (ch === "$" && currentLine[j + 1] === "{") {
          templateDepth++;
          continue;
        }
        if (ch === "}" && templateDepth > 0) {
          templateDepth--;
          continue;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "{" || ch === "(") {
        depth++;
        started = true;
      }
      if (ch === "}" || ch === ")") {
        depth--;
      }
    }
    if (started && depth <= 0) {
      return { source: result.join("\n"), endLine: i + 1 };
    }
  }
  if (result.length > 0) return { source: result.join("\n"), endLine: lineIdx + result.length };
  return null;
}

// ../indexer/source-resolver/filesystem.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
var nodeSourceResolverFileSystem = {
  exists: existsSync,
  readFile: (path) => readFile(path, "utf-8")
};

// ../indexer/source-resolver/original-source.ts
import { dirname as dirname2, resolve as resolvePath2 } from "node:path";

// ../../node_modules/.pnpm/@jridgewell+sourcemap-codec@1.5.5/node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.mjs
var comma = ",".charCodeAt(0);
var semicolon = ";".charCodeAt(0);
var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var intToChar = new Uint8Array(64);
var charToInt = new Uint8Array(128);
for (let i = 0; i < chars.length; i++) {
  const c = chars.charCodeAt(i);
  intToChar[i] = c;
  charToInt[c] = i;
}
function decodeInteger(reader, relative) {
  let value = 0;
  let shift = 0;
  let integer = 0;
  do {
    const c = reader.next();
    integer = charToInt[c];
    value |= (integer & 31) << shift;
    shift += 5;
  } while (integer & 32);
  const shouldNegate = value & 1;
  value >>>= 1;
  if (shouldNegate) {
    value = -2147483648 | -value;
  }
  return relative + value;
}
function hasMoreVlq(reader, max) {
  if (reader.pos >= max) return false;
  return reader.peek() !== comma;
}
var bufLength = 1024 * 16;
var StringReader = class {
  constructor(buffer) {
    this.pos = 0;
    this.buffer = buffer;
  }
  next() {
    return this.buffer.charCodeAt(this.pos++);
  }
  peek() {
    return this.buffer.charCodeAt(this.pos);
  }
  indexOf(char) {
    const { buffer, pos } = this;
    const idx = buffer.indexOf(char, pos);
    return idx === -1 ? buffer.length : idx;
  }
};
function decode(mappings) {
  const { length } = mappings;
  const reader = new StringReader(mappings);
  const decoded = [];
  let genColumn = 0;
  let sourcesIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let namesIndex = 0;
  do {
    const semi = reader.indexOf(";");
    const line = [];
    let sorted = true;
    let lastCol = 0;
    genColumn = 0;
    while (reader.pos < semi) {
      let seg;
      genColumn = decodeInteger(reader, genColumn);
      if (genColumn < lastCol) sorted = false;
      lastCol = genColumn;
      if (hasMoreVlq(reader, semi)) {
        sourcesIndex = decodeInteger(reader, sourcesIndex);
        sourceLine = decodeInteger(reader, sourceLine);
        sourceColumn = decodeInteger(reader, sourceColumn);
        if (hasMoreVlq(reader, semi)) {
          namesIndex = decodeInteger(reader, namesIndex);
          seg = [genColumn, sourcesIndex, sourceLine, sourceColumn, namesIndex];
        } else {
          seg = [genColumn, sourcesIndex, sourceLine, sourceColumn];
        }
      } else {
        seg = [genColumn];
      }
      line.push(seg);
      reader.pos++;
    }
    if (!sorted) sort(line);
    decoded.push(line);
    reader.pos = semi + 1;
  } while (reader.pos <= length);
  return decoded;
}
function sort(line) {
  line.sort(sortComparator);
}
function sortComparator(a, b) {
  return a[0] - b[0];
}

// ../../node_modules/.pnpm/@jridgewell+resolve-uri@3.1.2/node_modules/@jridgewell/resolve-uri/dist/resolve-uri.mjs
var schemeRegex = /^[\w+.-]+:\/\//;
var urlRegex = /^([\w+.-]+:)\/\/([^@/#?]*@)?([^:/#?]*)(:\d+)?(\/[^#?]*)?(\?[^#]*)?(#.*)?/;
var fileRegex = /^file:(?:\/\/((?![a-z]:)[^/#?]*)?)?(\/?[^#?]*)(\?[^#]*)?(#.*)?/i;
function isAbsoluteUrl(input) {
  return schemeRegex.test(input);
}
function isSchemeRelativeUrl(input) {
  return input.startsWith("//");
}
function isAbsolutePath(input) {
  return input.startsWith("/");
}
function isFileUrl(input) {
  return input.startsWith("file:");
}
function isRelative(input) {
  return /^[.?#]/.test(input);
}
function parseAbsoluteUrl(input) {
  const match = urlRegex.exec(input);
  return makeUrl(match[1], match[2] || "", match[3], match[4] || "", match[5] || "/", match[6] || "", match[7] || "");
}
function parseFileUrl(input) {
  const match = fileRegex.exec(input);
  const path = match[2];
  return makeUrl("file:", "", match[1] || "", "", isAbsolutePath(path) ? path : "/" + path, match[3] || "", match[4] || "");
}
function makeUrl(scheme, user, host, port, path, query, hash) {
  return {
    scheme,
    user,
    host,
    port,
    path,
    query,
    hash,
    type: 7
  };
}
function parseUrl(input) {
  if (isSchemeRelativeUrl(input)) {
    const url2 = parseAbsoluteUrl("http:" + input);
    url2.scheme = "";
    url2.type = 6;
    return url2;
  }
  if (isAbsolutePath(input)) {
    const url2 = parseAbsoluteUrl("http://foo.com" + input);
    url2.scheme = "";
    url2.host = "";
    url2.type = 5;
    return url2;
  }
  if (isFileUrl(input))
    return parseFileUrl(input);
  if (isAbsoluteUrl(input))
    return parseAbsoluteUrl(input);
  const url = parseAbsoluteUrl("http://foo.com/" + input);
  url.scheme = "";
  url.host = "";
  url.type = input ? input.startsWith("?") ? 3 : input.startsWith("#") ? 2 : 4 : 1;
  return url;
}
function stripPathFilename(path) {
  if (path.endsWith("/.."))
    return path;
  const index = path.lastIndexOf("/");
  return path.slice(0, index + 1);
}
function mergePaths(url, base) {
  normalizePath2(base, base.type);
  if (url.path === "/") {
    url.path = base.path;
  } else {
    url.path = stripPathFilename(base.path) + url.path;
  }
}
function normalizePath2(url, type) {
  const rel = type <= 4;
  const pieces = url.path.split("/");
  let pointer = 1;
  let positive = 0;
  let addTrailingSlash = false;
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece) {
      addTrailingSlash = true;
      continue;
    }
    addTrailingSlash = false;
    if (piece === ".")
      continue;
    if (piece === "..") {
      if (positive) {
        addTrailingSlash = true;
        positive--;
        pointer--;
      } else if (rel) {
        pieces[pointer++] = piece;
      }
      continue;
    }
    pieces[pointer++] = piece;
    positive++;
  }
  let path = "";
  for (let i = 1; i < pointer; i++) {
    path += "/" + pieces[i];
  }
  if (!path || addTrailingSlash && !path.endsWith("/..")) {
    path += "/";
  }
  url.path = path;
}
function resolve(input, base) {
  if (!input && !base)
    return "";
  const url = parseUrl(input);
  let inputType = url.type;
  if (base && inputType !== 7) {
    const baseUrl = parseUrl(base);
    const baseType = baseUrl.type;
    switch (inputType) {
      case 1:
        url.hash = baseUrl.hash;
      // fall through
      case 2:
        url.query = baseUrl.query;
      // fall through
      case 3:
      case 4:
        mergePaths(url, baseUrl);
      // fall through
      case 5:
        url.user = baseUrl.user;
        url.host = baseUrl.host;
        url.port = baseUrl.port;
      // fall through
      case 6:
        url.scheme = baseUrl.scheme;
    }
    if (baseType > inputType)
      inputType = baseType;
  }
  normalizePath2(url, inputType);
  const queryHash = url.query + url.hash;
  switch (inputType) {
    // This is impossible, because of the empty checks at the start of the function.
    // case UrlType.Empty:
    case 2:
    case 3:
      return queryHash;
    case 4: {
      const path = url.path.slice(1);
      if (!path)
        return queryHash || ".";
      if (isRelative(base || input) && !isRelative(path)) {
        return "./" + path + queryHash;
      }
      return path + queryHash;
    }
    case 5:
      return url.path + queryHash;
    default:
      return url.scheme + "//" + url.user + url.host + url.port + url.path + queryHash;
  }
}

// ../../node_modules/.pnpm/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs
function stripFilename(path) {
  if (!path) return "";
  const index = path.lastIndexOf("/");
  return path.slice(0, index + 1);
}
function resolver(mapUrl, sourceRoot) {
  const from = stripFilename(mapUrl);
  const prefix = sourceRoot ? sourceRoot + "/" : "";
  return (source) => resolve(prefix + (source || ""), from);
}
var COLUMN = 0;
var SOURCES_INDEX = 1;
var SOURCE_LINE = 2;
var SOURCE_COLUMN = 3;
var NAMES_INDEX = 4;
function maybeSort(mappings, owned) {
  const unsortedIndex = nextUnsortedSegmentLine(mappings, 0);
  if (unsortedIndex === mappings.length) return mappings;
  if (!owned) mappings = mappings.slice();
  for (let i = unsortedIndex; i < mappings.length; i = nextUnsortedSegmentLine(mappings, i + 1)) {
    mappings[i] = sortSegments(mappings[i], owned);
  }
  return mappings;
}
function nextUnsortedSegmentLine(mappings, start) {
  for (let i = start; i < mappings.length; i++) {
    if (!isSorted(mappings[i])) return i;
  }
  return mappings.length;
}
function isSorted(line) {
  for (let j = 1; j < line.length; j++) {
    if (line[j][COLUMN] < line[j - 1][COLUMN]) {
      return false;
    }
  }
  return true;
}
function sortSegments(line, owned) {
  if (!owned) line = line.slice();
  return line.sort(sortComparator2);
}
function sortComparator2(a, b) {
  return a[COLUMN] - b[COLUMN];
}
var found = false;
function binarySearch(haystack, needle, low, high) {
  while (low <= high) {
    const mid = low + (high - low >> 1);
    const cmp = haystack[mid][COLUMN] - needle;
    if (cmp === 0) {
      found = true;
      return mid;
    }
    if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  found = false;
  return low - 1;
}
function upperBound(haystack, needle, index) {
  for (let i = index + 1; i < haystack.length; index = i++) {
    if (haystack[i][COLUMN] !== needle) break;
  }
  return index;
}
function lowerBound(haystack, needle, index) {
  for (let i = index - 1; i >= 0; index = i--) {
    if (haystack[i][COLUMN] !== needle) break;
  }
  return index;
}
function memoizedState() {
  return {
    lastKey: -1,
    lastNeedle: -1,
    lastIndex: -1
  };
}
function memoizedBinarySearch(haystack, needle, state, key) {
  const { lastKey, lastNeedle, lastIndex } = state;
  let low = 0;
  let high = haystack.length - 1;
  if (key === lastKey) {
    if (needle === lastNeedle) {
      found = lastIndex !== -1 && haystack[lastIndex][COLUMN] === needle;
      return lastIndex;
    }
    if (needle >= lastNeedle) {
      low = lastIndex === -1 ? 0 : lastIndex;
    } else {
      high = lastIndex;
    }
  }
  state.lastKey = key;
  state.lastNeedle = needle;
  return state.lastIndex = binarySearch(haystack, needle, low, high);
}
function parse(map) {
  return typeof map === "string" ? JSON.parse(map) : map;
}
var LINE_GTR_ZERO = "`line` must be greater than 0 (lines start at line 1)";
var COL_GTR_EQ_ZERO = "`column` must be greater than or equal to 0 (columns start at column 0)";
var LEAST_UPPER_BOUND = -1;
var GREATEST_LOWER_BOUND = 1;
var TraceMap = class {
  constructor(map, mapUrl) {
    const isString = typeof map === "string";
    if (!isString && map._decodedMemo) return map;
    const parsed = parse(map);
    const { version, file, names, sourceRoot, sources, sourcesContent } = parsed;
    this.version = version;
    this.file = file;
    this.names = names || [];
    this.sourceRoot = sourceRoot;
    this.sources = sources;
    this.sourcesContent = sourcesContent;
    this.ignoreList = parsed.ignoreList || parsed.x_google_ignoreList || void 0;
    const resolve2 = resolver(mapUrl, sourceRoot);
    this.resolvedSources = sources.map(resolve2);
    const { mappings } = parsed;
    if (typeof mappings === "string") {
      this._encoded = mappings;
      this._decoded = void 0;
    } else if (Array.isArray(mappings)) {
      this._encoded = void 0;
      this._decoded = maybeSort(mappings, isString);
    } else if (parsed.sections) {
      throw new Error(`TraceMap passed sectioned source map, please use FlattenMap export instead`);
    } else {
      throw new Error(`invalid source map: ${JSON.stringify(parsed)}`);
    }
    this._decodedMemo = memoizedState();
    this._bySources = void 0;
    this._bySourceMemos = void 0;
  }
};
function cast(map) {
  return map;
}
function decodedMappings(map) {
  var _a;
  return (_a = cast(map))._decoded || (_a._decoded = decode(cast(map)._encoded));
}
function originalPositionFor(map, needle) {
  let { line, column, bias } = needle;
  line--;
  if (line < 0) throw new Error(LINE_GTR_ZERO);
  if (column < 0) throw new Error(COL_GTR_EQ_ZERO);
  const decoded = decodedMappings(map);
  if (line >= decoded.length) return OMapping(null, null, null, null);
  const segments = decoded[line];
  const index = traceSegmentInternal(
    segments,
    cast(map)._decodedMemo,
    line,
    column,
    bias || GREATEST_LOWER_BOUND
  );
  if (index === -1) return OMapping(null, null, null, null);
  const segment = segments[index];
  if (segment.length === 1) return OMapping(null, null, null, null);
  const { names, resolvedSources } = map;
  return OMapping(
    resolvedSources[segment[SOURCES_INDEX]],
    segment[SOURCE_LINE] + 1,
    segment[SOURCE_COLUMN],
    segment.length === 5 ? names[segment[NAMES_INDEX]] : null
  );
}
function sourceIndex(map, source) {
  const { sources, resolvedSources } = map;
  let index = sources.indexOf(source);
  if (index === -1) index = resolvedSources.indexOf(source);
  return index;
}
function sourceContentFor(map, source) {
  const { sourcesContent } = map;
  if (sourcesContent == null) return null;
  const index = sourceIndex(map, source);
  return index === -1 ? null : sourcesContent[index];
}
function OMapping(source, line, column, name) {
  return { source, line, column, name };
}
function traceSegmentInternal(segments, memo, line, column, bias) {
  let index = memoizedBinarySearch(segments, column, memo, line);
  if (found) {
    index = (bias === LEAST_UPPER_BOUND ? upperBound : lowerBound)(segments, column, index);
  } else if (bias === LEAST_UPPER_BOUND) index++;
  if (index === -1 || index === segments.length) return -1;
  return index;
}

// ../indexer/source-resolver/original-source.ts
function resolveOriginalPath(bundledFile, sourcePath) {
  if (!sourcePath) return null;
  try {
    return resolvePath2(dirname2(bundledFile), sourcePath);
  } catch {
    return null;
  }
}
async function loadOriginalSource(traceMap, bundledFile, sourcePath, fileSystem) {
  const loaded = await loadOriginalSourceWithKind(traceMap, bundledFile, sourcePath, fileSystem);
  return loaded?.content ?? null;
}
async function loadOriginalSourceWithKind(traceMap, bundledFile, sourcePath, fileSystem) {
  try {
    const sourceContent = sourceContentFor(traceMap, sourcePath);
    if (sourceContent) return { content: sourceContent, source: "source-map" };
  } catch {
  }
  const originalPath = resolveOriginalPath(bundledFile, sourcePath);
  if (!originalPath || !fileSystem.exists(originalPath)) return null;
  try {
    return { content: await fileSystem.readFile(originalPath), source: "disk" };
  } catch {
    return null;
  }
}

// ../indexer/source-resolver/protocol.ts
function parseSourceResolverWorkerRequest(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!isRecord(value) || typeof value.method !== "string") {
    return { ok: false, error: "request method is required" };
  }
  if (value.method === "resolveLocations") {
    if (!Array.isArray(value.locations) || !value.locations.every(isSourceLocation)) {
      return { ok: false, error: "resolveLocations requires locations" };
    }
    return { ok: true, request: { method: "resolveLocations", locations: value.locations } };
  }
  if (value.method === "resolveFnSource") {
    if (typeof value.file !== "string" || !isFiniteNumber(value.line)) {
      return { ok: false, error: "resolveFnSource requires file and line" };
    }
    if (value.column !== void 0 && !isFiniteNumber(value.column)) {
      return { ok: false, error: "resolveFnSource column must be a number" };
    }
    return {
      ok: true,
      request: {
        method: "resolveFnSource",
        file: value.file,
        line: value.line,
        column: value.column
      }
    };
  }
  if (value.method === "resolveSourceFrame") {
    if (typeof value.file !== "string" || !isFiniteNumber(value.line)) {
      return { ok: false, error: "resolveSourceFrame requires file and line" };
    }
    if (value.column !== void 0 && !isFiniteNumber(value.column)) {
      return { ok: false, error: "resolveSourceFrame column must be a number" };
    }
    if (value.frameRadius !== void 0 && !isFiniteNumber(value.frameRadius)) {
      return { ok: false, error: "resolveSourceFrame frameRadius must be a number" };
    }
    if (value.sourceRef !== void 0 && typeof value.sourceRef !== "string") {
      return { ok: false, error: "resolveSourceFrame sourceRef must be a string" };
    }
    if (value.role !== void 0 && !isSourceFrameLineRole(value.role)) {
      return { ok: false, error: "resolveSourceFrame role is invalid" };
    }
    if (value.capturedAt !== void 0 && typeof value.capturedAt !== "string") {
      return { ok: false, error: "resolveSourceFrame capturedAt must be a string" };
    }
    return {
      ok: true,
      request: {
        method: "resolveSourceFrame",
        file: value.file,
        line: value.line,
        column: value.column,
        sourceRef: value.sourceRef,
        frameRadius: value.frameRadius,
        role: value.role,
        capturedAt: value.capturedAt
      }
    };
  }
  return { ok: false, error: `unknown method: ${value.method}` };
}
function serializeSourceResolverWorkerResponse(value) {
  return `${JSON.stringify(value)}
`;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isSourceLocation(value) {
  if (!isRecord(value)) return false;
  if (typeof value.file !== "string" || !isFiniteNumber(value.line)) return false;
  if (value.column !== void 0 && !isFiniteNumber(value.column)) return false;
  if (value.function !== void 0 && typeof value.function !== "string") return false;
  return true;
}
function isSourceFrameLineRole(value) {
  return value === "context" || value === "failed" || value === "passed" || value === "not-evaluated";
}

// ../indexer/source-resolver/resolver.ts
import { createHash } from "node:crypto";
import { extname } from "node:path";

// ../indexer/source-resolver/trace-map.ts
function parseTraceMap(mapJson) {
  try {
    return new TraceMap(mapJson);
  } catch {
    return null;
  }
}
function resolveOriginalPosition(traceMap, line, column) {
  const pos = originalPositionFor(traceMap, { line, column: column ?? 0 });
  if (!pos.source) return { kind: "unresolved", reason: "original-source-missing" };
  if (!pos.line) return { kind: "unresolved", reason: "original-line-missing" };
  return {
    kind: "resolved",
    file: pos.source,
    line: pos.line,
    column: pos.column ?? void 0,
    name: pos.name ?? void 0
  };
}

// ../indexer/source-resolver/resolver.ts
var DIRECT_SOURCE_FRAME_EXTENSIONS = /* @__PURE__ */ new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
var GENERATED_PATH_SEGMENTS = /* @__PURE__ */ new Set([
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);
var SourceResolver = class {
  fileSystem;
  mapCache = /* @__PURE__ */ new Map();
  locationCache = /* @__PURE__ */ new Map();
  /** Create a source resolver with optional filesystem dependency injection. */
  constructor(options = {}) {
    this.fileSystem = options.fileSystem ?? nodeSourceResolverFileSystem;
  }
  /**
   * Resolve a single bundled source location to its original position.
   *
   * Unresolved lookups return the original bundled location with
   * `resolved: false` instead of throwing.
   */
  async resolveLocation(file, line, column, fn) {
    const key = locationCacheKey(file, line, column);
    const cached = this.locationCache.get(key);
    if (cached) return cached;
    const traceMap = await this.loadTraceMap(file);
    if (!traceMap) return this.cacheAndReturn(key, unresolvedLocation(file, line, column, fn));
    const resolved = resolveOriginalPosition(traceMap, line, column);
    if (resolved.kind === "unresolved") return this.cacheAndReturn(key, unresolvedLocation(file, line, column, fn));
    return this.cacheAndReturn(key, {
      file: resolved.file,
      line: resolved.line,
      column: resolved.column,
      function: resolved.name ?? fn,
      resolved: true
    });
  }
  /**
   * Resolve and extract a function's original source code.
   *
   * Source text is loaded from `sourcesContent` first and falls back to disk.
   * Missing maps, missing source text, or extraction misses return `null`.
   */
  async resolveFnSource(file, line, column) {
    const traceMap = await this.loadTraceMap(file);
    if (!traceMap) return null;
    const resolved = resolveOriginalPosition(traceMap, line, column);
    if (resolved.kind === "unresolved") return null;
    const content = await loadOriginalSource(traceMap, normalizePath(file), resolved.file, this.fileSystem);
    if (!content) return null;
    const extracted = extractFunctionBody(content, resolved.line, resolved.column ?? 0);
    if (!extracted) return null;
    return {
      source: extracted.source,
      file: resolved.file,
      startLine: resolved.line,
      resolved: true
    };
  }
  /**
   * Resolve a generated location into a narrow authored source-frame snapshot.
   *
   * Generated code is never returned as a fallback. When the captured location
   * already points at an authored source file, the resolver can snapshot that
   * file directly from disk; otherwise missing maps, missing source content, or
   * unmapped positions produce `kind: 'unavailable'`.
   */
  async resolveSourceFrame(file, line, column, options = {}) {
    const normalized = normalizePath(file);
    const traceMap = await this.loadTraceMap(normalized);
    if (!traceMap) {
      const directFrame = await this.resolveDirectSourceFrame(normalized, line, column, options);
      return directFrame ?? { kind: "unavailable", reason: "source-map-missing" };
    }
    const resolved = resolveOriginalPosition(traceMap, line, column);
    if (resolved.kind === "unresolved") return { kind: "unavailable", reason: "source-file-missing" };
    const loaded = await loadOriginalSourceWithKind(traceMap, normalized, resolved.file, this.fileSystem);
    if (!loaded) return { kind: "unavailable", reason: "source-file-missing" };
    const sourceLines = splitSourceLines(loaded.content);
    const authoredLine = resolved.line;
    if (authoredLine < 1 || authoredLine > sourceLines.length) {
      return { kind: "unavailable", reason: "source-file-missing" };
    }
    const radius = options.frameRadius ?? 4;
    const frameStartLine = Math.max(1, authoredLine - radius);
    const frameEndLine = Math.min(sourceLines.length, authoredLine + radius);
    const role = options.role ?? "failed";
    const lines = sourceLines.slice(frameStartLine - 1, frameEndLine).map((text, index) => {
      const sourceLine = frameStartLine + index;
      return {
        line: sourceLine,
        text,
        role: sourceLine === authoredLine ? role : "context"
      };
    });
    const frameText = lines.map((frameLine) => frameLine.text).join("\n");
    return {
      kind: "source-frame",
      sourceRef: options.sourceRef ?? `${file}:${line}:${column ?? 0}`,
      authoredFile: resolved.file,
      authoredLine,
      ...resolved.column !== void 0 ? { authoredColumn: resolved.column } : {},
      frameStartLine,
      frameEndLine,
      lines,
      contentHash: `sha256:${sha256(frameText)}`,
      capturedAt: options.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      stale: false,
      resolver: loaded.source
    };
  }
  /** Resolve an array of bundled stack frames in parallel. */
  async resolveStack(frames) {
    return Promise.all(frames.map((f) => this.resolveLocation(f.file, f.line, f.column, f.function)));
  }
  cacheAndReturn(key, value) {
    this.locationCache = putLocationCache(this.locationCache, key, value);
    return value;
  }
  async loadTraceMap(file) {
    const normalized = normalizePath(file);
    const cached = this.mapCache.get(normalized);
    if (cached !== void 0) return cached;
    const discovered = await discoverSourceMap(normalized, this.fileSystem);
    if (discovered.kind === "not-found") {
      this.mapCache.set(normalized, null);
      return null;
    }
    const traceMap = parseTraceMap(discovered.mapJson);
    this.mapCache.set(normalized, traceMap);
    return traceMap;
  }
  /**
   * Resolve frames for stack refs that are already authored source locations.
   *
   * Assertion stacks from TypeScript runtimes such as `tsx` often arrive as
   * `.eval.ts` source refs. They do not need source-map lookup, but generated
   * output files without maps still degrade instead of leaking compiled code.
   */
  async resolveDirectSourceFrame(file, line, column, options) {
    if (!isDirectAuthoredSourceCandidate(file) || !this.fileSystem.exists(file)) return null;
    let content;
    try {
      content = await this.fileSystem.readFile(file);
    } catch {
      return { kind: "unavailable", reason: "source-file-missing" };
    }
    const sourceLines = splitSourceLines(content);
    if (line < 1 || line > sourceLines.length) {
      return { kind: "unavailable", reason: "source-file-missing" };
    }
    const radius = options.frameRadius ?? 4;
    const frameStartLine = Math.max(1, line - radius);
    const frameEndLine = Math.min(sourceLines.length, line + radius);
    const role = options.role ?? "failed";
    const lines = sourceLines.slice(frameStartLine - 1, frameEndLine).map((text, index) => {
      const sourceLine = frameStartLine + index;
      return {
        line: sourceLine,
        text,
        role: sourceLine === line ? role : "context"
      };
    });
    const frameText = lines.map((frameLine) => frameLine.text).join("\n");
    return {
      kind: "source-frame",
      sourceRef: options.sourceRef ?? `${file}:${line}:${column ?? 0}`,
      authoredFile: file,
      authoredLine: line,
      ...column !== void 0 ? { authoredColumn: column } : {},
      frameStartLine,
      frameEndLine,
      lines,
      contentHash: `sha256:${sha256(frameText)}`,
      capturedAt: options.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      stale: false,
      resolver: "disk"
    };
  }
};
function unresolvedLocation(file, line, column, fn) {
  return { file, line, column, function: fn, resolved: false };
}
function splitSourceLines(source) {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function isDirectAuthoredSourceCandidate(file) {
  const extension = extname(file);
  if (!DIRECT_SOURCE_FRAME_EXTENSIONS.has(extension)) return false;
  const segments = file.split(/[\\/]+/).filter(Boolean);
  return !segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment));
}

// bin/source-resolver.ts
var resolver2 = new SourceResolver();
var rl = createInterface({
  input: process.stdin,
  terminal: false
});
var pending = 0;
var closing = false;
function maybeExit() {
  if (closing && pending === 0) process.exit(0);
}
async function writeResponse(value) {
  const line = serializeSourceResolverWorkerResponse(value);
  await new Promise((resolve2, reject) => {
    process.stdout.write(line, (error) => {
      if (error) reject(error);
      else resolve2();
    });
  });
}
rl.on("line", (line) => {
  pending += 1;
  void handleLine(line).finally(() => {
    pending -= 1;
    maybeExit();
  });
});
async function handleLine(line) {
  try {
    const parsed = parseSourceResolverWorkerRequest(line);
    if (!parsed.ok) {
      await writeResponse({ error: parsed.error });
      return;
    }
    let result;
    const req = parsed.request;
    switch (req.method) {
      case "resolveLocations": {
        const locations = await Promise.all(
          req.locations.map((loc) => resolver2.resolveLocation(loc.file, loc.line, loc.column, loc.function))
        );
        result = { locations };
        break;
      }
      case "resolveFnSource": {
        const fnSource = await resolver2.resolveFnSource(req.file, req.line, req.column);
        result = fnSource ?? { source: null, resolved: false };
        break;
      }
      case "resolveSourceFrame": {
        result = await resolver2.resolveSourceFrame(req.file, req.line, req.column, {
          ...req.sourceRef !== void 0 ? { sourceRef: req.sourceRef } : {},
          ...req.frameRadius !== void 0 ? { frameRadius: req.frameRadius } : {},
          ...req.role !== void 0 ? { role: req.role } : {},
          ...req.capturedAt !== void 0 ? { capturedAt: req.capturedAt } : {}
        });
        break;
      }
    }
    await writeResponse(result);
  } catch (err) {
    const message = errorMessage(err);
    process.stderr.write(`[source-resolver] error: ${message}
`);
    await writeResponse({ error: message });
  }
}
rl.on("close", () => {
  closing = true;
  maybeExit();
});
