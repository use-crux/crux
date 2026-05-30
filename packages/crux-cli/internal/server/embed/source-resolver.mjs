import { createRequire as __crux_createRequire } from "node:module"; import { fileURLToPath as __crux_fileURLToPath } from "node:url"; import { dirname as __crux_dirname } from "node:path"; const require = __crux_createRequire(import.meta.url); const __filename = __crux_fileURLToPath(import.meta.url); const __dirname = __crux_dirname(__filename);

// bin/source-resolver.ts
import { createInterface } from "node:readline";

// ../crux-source-indexer/source-resolver.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// ../../node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.mjs
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

// ../../node_modules/@jridgewell/resolve-uri/dist/resolve-uri.mjs
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
  normalizePath(base, base.type);
  if (url.path === "/") {
    url.path = base.path;
  } else {
    url.path = stripPathFilename(base.path) + url.path;
  }
}
function normalizePath(url, type) {
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
  normalizePath(url, inputType);
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

// ../../node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs
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

// ../crux-source-indexer/source-resolver.ts
var MAX_LOCATION_CACHE = 5e3;
var MAX_FN_EXTRACT_LINES = 200;
var SourceResolver = class {
  /** Parsed TraceMap cache, keyed by normalized bundled file path. */
  mapCache = /* @__PURE__ */ new Map();
  /** Resolved location cache, keyed by `file:line:column`. */
  locationCache = /* @__PURE__ */ new Map();
  /** Bundled file content cache. */
  fileContentCache = /* @__PURE__ */ new Map();
  /**
   * Resolve a single bundled source location to its original position.
   */
  async resolveLocation(file, line, column, fn) {
    const cacheKey = `${file}:${line}:${column ?? 0}`;
    const cached = this.locationCache.get(cacheKey);
    if (cached) return cached;
    const traceMap = await this.loadTraceMap(file);
    if (!traceMap) {
      const result2 = {
        file,
        line,
        column,
        function: fn,
        resolved: false
      };
      this.cacheLocation(cacheKey, result2);
      return result2;
    }
    const pos = originalPositionFor(traceMap, { line, column: column ?? 0 });
    if (!pos.source) {
      const result2 = {
        file,
        line,
        column,
        function: fn,
        resolved: false
      };
      this.cacheLocation(cacheKey, result2);
      return result2;
    }
    const result = {
      file: pos.source,
      line: pos.line,
      column: pos.column ?? void 0,
      function: pos.name ?? fn,
      resolved: true
    };
    this.cacheLocation(cacheKey, result);
    return result;
  }
  /**
   * Resolve a function's source code from a bundled file location.
   *
   * Uses the source map to find the original file + line, then extracts
   * the function body from the original source using `sourcesContent`.
   */
  async resolveFnSource(file, line, column) {
    const traceMap = await this.loadTraceMap(file);
    if (!traceMap) return null;
    const pos = originalPositionFor(traceMap, { line, column: column ?? 0 });
    if (!pos.source || !pos.line) return null;
    let content = null;
    try {
      content = sourceContentFor(traceMap, pos.source);
    } catch {
    }
    if (!content) {
      const originalPath = resolveOriginalPath(file, pos.source);
      if (originalPath && existsSync(originalPath)) {
        try {
          content = await readFile(originalPath, "utf-8");
        } catch {
        }
      }
    }
    if (!content) return null;
    const extracted = extractFunctionBody(content, pos.line, pos.column ?? 0);
    if (!extracted) return null;
    return {
      source: extracted.source,
      file: pos.source,
      startLine: pos.line,
      resolved: true
    };
  }
  /**
   * Resolve an array of stack frames in a single batch.
   */
  async resolveStack(frames) {
    return Promise.all(frames.map((f) => this.resolveLocation(f.file, f.line, f.column, f.function)));
  }
  // ─── Private helpers ───
  async loadTraceMap(file) {
    const normalized = normalizePath2(file);
    const cached = this.mapCache.get(normalized);
    if (cached !== void 0) return cached;
    const mapJson = await discoverSourceMap(normalized);
    if (!mapJson) {
      this.mapCache.set(normalized, null);
      return null;
    }
    try {
      const traceMap = new TraceMap(mapJson);
      this.mapCache.set(normalized, traceMap);
      return traceMap;
    } catch {
      this.mapCache.set(normalized, null);
      return null;
    }
  }
  cacheLocation(key, value) {
    if (this.locationCache.size >= MAX_LOCATION_CACHE) {
      const firstKey = this.locationCache.keys().next().value;
      if (firstKey !== void 0) this.locationCache.delete(firstKey);
    }
    this.locationCache.set(key, value);
  }
};
async function discoverSourceMap(bundledFile) {
  const sidecarPath = bundledFile + ".map";
  if (existsSync(sidecarPath)) {
    try {
      return await readFile(sidecarPath, "utf-8");
    } catch {
    }
  }
  let bundleContent;
  try {
    bundleContent = await readFile(bundledFile, "utf-8");
  } catch {
    return null;
  }
  const tail = bundleContent.slice(-2e3);
  const match = tail.match(/\/\/[#@]\s*sourceMappingURL=(.+)$/m);
  if (!match) return null;
  const url = match[1].trim();
  if (url.startsWith("data:")) {
    const base64Match = url.match(/;base64,(.+)/);
    if (!base64Match) return null;
    try {
      return Buffer.from(base64Match[1], "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  const mapPath = resolvePath(dirname(bundledFile), url);
  if (existsSync(mapPath)) {
    try {
      return await readFile(mapPath, "utf-8");
    } catch {
    }
  }
  return null;
}
function normalizePath2(filePath) {
  if (filePath.startsWith("file://")) {
    try {
      return fileURLToPath(filePath);
    } catch {
      return filePath.replace(/^file:\/\//, "");
    }
  }
  return filePath;
}
function resolveOriginalPath(bundledFile, sourcePath) {
  if (!sourcePath) return null;
  try {
    return resolvePath(dirname(bundledFile), sourcePath);
  } catch {
    return null;
  }
}
function extractFunctionBody(source, startLine, startColumn) {
  const lines = source.split("\n");
  if (startLine < 1 || startLine > lines.length) return null;
  const lineIdx = startLine - 1;
  const startText = lines[lineIdx];
  const result = [];
  let depth = 0;
  let inString = null;
  let inTemplate = false;
  let templateDepth = 0;
  let started = false;
  for (let i = lineIdx; i < lines.length && i < lineIdx + MAX_FN_EXTRACT_LINES; i++) {
    const line = i === lineIdx ? lines[i].slice(Math.max(0, startColumn)) : lines[i];
    result.push(i === lineIdx ? lines[i] : lines[i]);
    for (let j = i === lineIdx ? startColumn : 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      const prev = j > 0 ? lines[i][j - 1] : "";
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
        if (ch === "$" && j + 1 < lines[i].length && lines[i][j + 1] === "{") {
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
  if (!started && result.length > 0) {
    return { source: result.join("\n"), endLine: lineIdx + result.length };
  }
  if (result.length > 0) {
    return { source: result.join("\n"), endLine: lineIdx + result.length };
  }
  return null;
}

// bin/source-resolver.ts
var resolver2 = new SourceResolver();
var rl = createInterface({
  input: process.stdin,
  terminal: false
});
rl.on("line", async (line) => {
  try {
    const req = JSON.parse(line);
    let result;
    switch (req.method) {
      case "resolveLocations": {
        const locations = await Promise.all(
          (req.locations ?? []).map(
            (loc) => resolver2.resolveLocation(loc.file, loc.line, loc.column, loc.function)
          )
        );
        result = { locations };
        break;
      }
      case "resolveFnSource": {
        const fnSource = await resolver2.resolveFnSource(req.file, req.line, req.column);
        result = fnSource ?? { source: null, resolved: false };
        break;
      }
      default:
        result = { error: `unknown method: ${req.method}` };
    }
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[source-resolver] error: ${message}
`);
    process.stdout.write(JSON.stringify({ error: message }) + "\n");
  }
});
rl.on("close", () => {
  process.exit(0);
});
