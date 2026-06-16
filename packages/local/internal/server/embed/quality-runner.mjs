#!/usr/bin/env tsx
import { createRequire as __crux_createRequire } from "node:module"; import { fileURLToPath as __crux_fileURLToPath } from "node:url"; import { dirname as __crux_dirname } from "node:path"; const require = __crux_createRequire(import.meta.url); const __filename = __crux_fileURLToPath(import.meta.url); const __dirname = __crux_dirname(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/constants.js"(exports, module) {
    "use strict";
    var WIN_SLASH = "\\\\/";
    var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
    var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
    var DOT_LITERAL = "\\.";
    var PLUS_LITERAL = "\\+";
    var QMARK_LITERAL = "\\?";
    var SLASH_LITERAL = "\\/";
    var ONE_CHAR = "(?=.)";
    var QMARK = "[^/]";
    var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
    var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
    var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
    var NO_DOT = `(?!${DOT_LITERAL})`;
    var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
    var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
    var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
    var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
    var STAR = `${QMARK}*?`;
    var SEP = "/";
    var POSIX_CHARS = {
      DOT_LITERAL,
      PLUS_LITERAL,
      QMARK_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      QMARK,
      END_ANCHOR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR,
      SEP
    };
    var WINDOWS_CHARS = {
      ...POSIX_CHARS,
      SLASH_LITERAL: `[${WIN_SLASH}]`,
      QMARK: WIN_NO_SLASH,
      STAR: `${WIN_NO_SLASH}*?`,
      DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
      NO_DOT: `(?!${DOT_LITERAL})`,
      NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
      NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
      START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
      END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
      SEP: "\\"
    };
    var POSIX_REGEX_SOURCE = {
      __proto__: null,
      alnum: "a-zA-Z0-9",
      alpha: "a-zA-Z",
      ascii: "\\x00-\\x7F",
      blank: " \\t",
      cntrl: "\\x00-\\x1F\\x7F",
      digit: "0-9",
      graph: "\\x21-\\x7E",
      lower: "a-z",
      print: "\\x20-\\x7E ",
      punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
      space: " \\t\\r\\n\\v\\f",
      upper: "A-Z",
      word: "A-Za-z0-9_",
      xdigit: "A-Fa-f0-9"
    };
    module.exports = {
      DEFAULT_MAX_EXTGLOB_RECURSION,
      MAX_LENGTH: 1024 * 64,
      POSIX_REGEX_SOURCE,
      // regular expressions
      REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
      REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
      REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
      REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
      REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
      REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
      // Replace globs with equivalent patterns to reduce parsing time.
      REPLACEMENTS: {
        __proto__: null,
        "***": "*",
        "**/**": "**",
        "**/**/**": "**"
      },
      // Digits
      CHAR_0: 48,
      /* 0 */
      CHAR_9: 57,
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: 65,
      /* A */
      CHAR_LOWERCASE_A: 97,
      /* a */
      CHAR_UPPERCASE_Z: 90,
      /* Z */
      CHAR_LOWERCASE_Z: 122,
      /* z */
      CHAR_LEFT_PARENTHESES: 40,
      /* ( */
      CHAR_RIGHT_PARENTHESES: 41,
      /* ) */
      CHAR_ASTERISK: 42,
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: 38,
      /* & */
      CHAR_AT: 64,
      /* @ */
      CHAR_BACKWARD_SLASH: 92,
      /* \ */
      CHAR_CARRIAGE_RETURN: 13,
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: 94,
      /* ^ */
      CHAR_COLON: 58,
      /* : */
      CHAR_COMMA: 44,
      /* , */
      CHAR_DOT: 46,
      /* . */
      CHAR_DOUBLE_QUOTE: 34,
      /* " */
      CHAR_EQUAL: 61,
      /* = */
      CHAR_EXCLAMATION_MARK: 33,
      /* ! */
      CHAR_FORM_FEED: 12,
      /* \f */
      CHAR_FORWARD_SLASH: 47,
      /* / */
      CHAR_GRAVE_ACCENT: 96,
      /* ` */
      CHAR_HASH: 35,
      /* # */
      CHAR_HYPHEN_MINUS: 45,
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: 60,
      /* < */
      CHAR_LEFT_CURLY_BRACE: 123,
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: 91,
      /* [ */
      CHAR_LINE_FEED: 10,
      /* \n */
      CHAR_NO_BREAK_SPACE: 160,
      /* \u00A0 */
      CHAR_PERCENT: 37,
      /* % */
      CHAR_PLUS: 43,
      /* + */
      CHAR_QUESTION_MARK: 63,
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: 62,
      /* > */
      CHAR_RIGHT_CURLY_BRACE: 125,
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: 93,
      /* ] */
      CHAR_SEMICOLON: 59,
      /* ; */
      CHAR_SINGLE_QUOTE: 39,
      /* ' */
      CHAR_SPACE: 32,
      /*   */
      CHAR_TAB: 9,
      /* \t */
      CHAR_UNDERSCORE: 95,
      /* _ */
      CHAR_VERTICAL_LINE: 124,
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
      /* \uFEFF */
      /**
       * Create EXTGLOB_CHARS
       */
      extglobChars(chars2) {
        return {
          "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars2.STAR})` },
          "?": { type: "qmark", open: "(?:", close: ")?" },
          "+": { type: "plus", open: "(?:", close: ")+" },
          "*": { type: "star", open: "(?:", close: ")*" },
          "@": { type: "at", open: "(?:", close: ")" }
        };
      },
      /**
       * Create GLOB_CHARS
       */
      globChars(win32) {
        return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
      }
    };
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/utils.js"(exports) {
    "use strict";
    var {
      REGEX_BACKSLASH,
      REGEX_REMOVE_BACKSLASH,
      REGEX_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_GLOBAL
    } = require_constants();
    exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
    exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
    exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
    exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
    exports.isWindows = () => {
      if (typeof navigator !== "undefined" && navigator.platform) {
        const platform = navigator.platform.toLowerCase();
        return platform === "win32" || platform === "windows";
      }
      if (typeof process !== "undefined" && process.platform) {
        return process.platform === "win32";
      }
      return false;
    };
    exports.removeBackslashes = (str) => {
      return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
        return match === "\\" ? "" : match;
      });
    };
    exports.escapeLast = (input, char, lastIdx) => {
      const idx = input.lastIndexOf(char, lastIdx);
      if (idx === -1) return input;
      if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
      return `${input.slice(0, idx)}\\${input.slice(idx)}`;
    };
    exports.removePrefix = (input, state = {}) => {
      let output = input;
      if (output.startsWith("./")) {
        output = output.slice(2);
        state.prefix = "./";
      }
      return output;
    };
    exports.wrapOutput = (input, state = {}, options = {}) => {
      const prepend = options.contains ? "" : "^";
      const append = options.contains ? "" : "$";
      let output = `${prepend}(?:${input})${append}`;
      if (state.negated === true) {
        output = `(?:^(?!${output}).*$)`;
      }
      return output;
    };
    exports.basename = (path, { windows } = {}) => {
      const segs = path.split(windows ? /[\\/]/ : "/");
      const last = segs[segs.length - 1];
      if (last === "") {
        return segs[segs.length - 2];
      }
      return last;
    };
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/scan.js"(exports, module) {
    "use strict";
    var utils = require_utils();
    var {
      CHAR_ASTERISK,
      /* * */
      CHAR_AT,
      /* @ */
      CHAR_BACKWARD_SLASH,
      /* \ */
      CHAR_COMMA,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_EXCLAMATION_MARK,
      /* ! */
      CHAR_FORWARD_SLASH,
      /* / */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_LEFT_SQUARE_BRACKET,
      /* [ */
      CHAR_PLUS,
      /* + */
      CHAR_QUESTION_MARK,
      /* ? */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_RIGHT_SQUARE_BRACKET
      /* ] */
    } = require_constants();
    var isPathSeparator = (code) => {
      return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
    };
    var depth = (token) => {
      if (token.isPrefix !== true) {
        token.depth = token.isGlobstar ? Infinity : 1;
      }
    };
    var scan = (input, options) => {
      const opts = options || {};
      const length = input.length - 1;
      const scanToEnd = opts.parts === true || opts.scanToEnd === true;
      const slashes = [];
      const tokens = [];
      const parts = [];
      let str = input;
      let index = -1;
      let start = 0;
      let lastIndex = 0;
      let isBrace = false;
      let isBracket = false;
      let isGlob = false;
      let isExtglob = false;
      let isGlobstar = false;
      let braceEscaped = false;
      let backslashes = false;
      let negated = false;
      let negatedExtglob = false;
      let finished = false;
      let braces = 0;
      let prev;
      let code;
      let token = { value: "", depth: 0, isGlob: false };
      const eos = () => index >= length;
      const peek = () => str.charCodeAt(index + 1);
      const advance = () => {
        prev = code;
        return str.charCodeAt(++index);
      };
      while (index < length) {
        code = advance();
        let next;
        if (code === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          code = advance();
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braceEscaped = true;
          }
          continue;
        }
        if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
          braces++;
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (code === CHAR_LEFT_CURLY_BRACE) {
              braces++;
              continue;
            }
            if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (braceEscaped !== true && code === CHAR_COMMA) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (code === CHAR_RIGHT_CURLY_BRACE) {
              braces--;
              if (braces === 0) {
                braceEscaped = false;
                isBrace = token.isBrace = true;
                finished = true;
                break;
              }
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_FORWARD_SLASH) {
          slashes.push(index);
          tokens.push(token);
          token = { value: "", depth: 0, isGlob: false };
          if (finished === true) continue;
          if (prev === CHAR_DOT && index === start + 1) {
            start += 2;
            continue;
          }
          lastIndex = index + 1;
          continue;
        }
        if (opts.noext !== true) {
          const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
          if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
            isGlob = token.isGlob = true;
            isExtglob = token.isExtglob = true;
            finished = true;
            if (code === CHAR_EXCLAMATION_MARK && index === start) {
              negatedExtglob = true;
            }
            if (scanToEnd === true) {
              while (eos() !== true && (code = advance())) {
                if (code === CHAR_BACKWARD_SLASH) {
                  backslashes = token.backslashes = true;
                  code = advance();
                  continue;
                }
                if (code === CHAR_RIGHT_PARENTHESES) {
                  isGlob = token.isGlob = true;
                  finished = true;
                  break;
                }
              }
              continue;
            }
            break;
          }
        }
        if (code === CHAR_ASTERISK) {
          if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_QUESTION_MARK) {
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_LEFT_SQUARE_BRACKET) {
          while (eos() !== true && (next = advance())) {
            if (next === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET) {
              isBracket = token.isBracket = true;
              isGlob = token.isGlob = true;
              finished = true;
              break;
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
          negated = token.negated = true;
          start++;
          continue;
        }
        if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_LEFT_PARENTHESES) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES) {
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
        if (isGlob === true) {
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
      }
      if (opts.noext === true) {
        isExtglob = false;
        isGlob = false;
      }
      let base = str;
      let prefix = "";
      let glob2 = "";
      if (start > 0) {
        prefix = str.slice(0, start);
        str = str.slice(start);
        lastIndex -= start;
      }
      if (base && isGlob === true && lastIndex > 0) {
        base = str.slice(0, lastIndex);
        glob2 = str.slice(lastIndex);
      } else if (isGlob === true) {
        base = "";
        glob2 = str;
      } else {
        base = str;
      }
      if (base && base !== "" && base !== "/" && base !== str) {
        if (isPathSeparator(base.charCodeAt(base.length - 1))) {
          base = base.slice(0, -1);
        }
      }
      if (opts.unescape === true) {
        if (glob2) glob2 = utils.removeBackslashes(glob2);
        if (base && backslashes === true) {
          base = utils.removeBackslashes(base);
        }
      }
      const state = {
        prefix,
        input,
        start,
        base,
        glob: glob2,
        isBrace,
        isBracket,
        isGlob,
        isExtglob,
        isGlobstar,
        negated,
        negatedExtglob
      };
      if (opts.tokens === true) {
        state.maxDepth = 0;
        if (!isPathSeparator(code)) {
          tokens.push(token);
        }
        state.tokens = tokens;
      }
      if (opts.parts === true || opts.tokens === true) {
        let prevIndex;
        for (let idx = 0; idx < slashes.length; idx++) {
          const n = prevIndex ? prevIndex + 1 : start;
          const i = slashes[idx];
          const value = input.slice(n, i);
          if (opts.tokens) {
            if (idx === 0 && start !== 0) {
              tokens[idx].isPrefix = true;
              tokens[idx].value = prefix;
            } else {
              tokens[idx].value = value;
            }
            depth(tokens[idx]);
            state.maxDepth += tokens[idx].depth;
          }
          if (idx !== 0 || value !== "") {
            parts.push(value);
          }
          prevIndex = i;
        }
        if (prevIndex && prevIndex + 1 < input.length) {
          const value = input.slice(prevIndex + 1);
          parts.push(value);
          if (opts.tokens) {
            tokens[tokens.length - 1].value = value;
            depth(tokens[tokens.length - 1]);
            state.maxDepth += tokens[tokens.length - 1].depth;
          }
        }
        state.slashes = slashes;
        state.parts = parts;
      }
      return state;
    };
    module.exports = scan;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/parse.js
var require_parse = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/parse.js"(exports, module) {
    "use strict";
    var constants = require_constants();
    var utils = require_utils();
    var {
      MAX_LENGTH,
      POSIX_REGEX_SOURCE,
      REGEX_NON_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_BACKREF,
      REPLACEMENTS
    } = constants;
    var expandRange = (args, options) => {
      if (typeof options.expandRange === "function") {
        return options.expandRange(...args, options);
      }
      args.sort();
      const value = `[${args.join("-")}]`;
      try {
        new RegExp(value);
      } catch (ex) {
        return args.map((v) => utils.escapeRegex(v)).join("..");
      }
      return value;
    };
    var syntaxError = (type, char) => {
      return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
    };
    var splitTopLevel = (input) => {
      const parts = [];
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let value = "";
      let escaped = false;
      for (const ch of input) {
        if (escaped === true) {
          value += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          value += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          value += ch;
          continue;
        }
        if (quote === 0) {
          if (ch === "[") {
            bracket++;
          } else if (ch === "]" && bracket > 0) {
            bracket--;
          } else if (bracket === 0) {
            if (ch === "(") {
              paren++;
            } else if (ch === ")" && paren > 0) {
              paren--;
            } else if (ch === "|" && paren === 0) {
              parts.push(value);
              value = "";
              continue;
            }
          }
        }
        value += ch;
      }
      parts.push(value);
      return parts;
    };
    var isPlainBranch = (branch) => {
      let escaped = false;
      for (const ch of branch) {
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (/[?*+@!()[\]{}]/.test(ch)) {
          return false;
        }
      }
      return true;
    };
    var normalizeSimpleBranch = (branch) => {
      let value = branch.trim();
      let changed = true;
      while (changed === true) {
        changed = false;
        if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
          value = value.slice(2, -1);
          changed = true;
        }
      }
      if (!isPlainBranch(value)) {
        return;
      }
      return value.replace(/\\(.)/g, "$1");
    };
    var hasRepeatedCharPrefixOverlap = (branches) => {
      const values = branches.map(normalizeSimpleBranch).filter(Boolean);
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i];
          const b = values[j];
          const char = a[0];
          if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
            continue;
          }
          if (a === b || a.startsWith(b) || b.startsWith(a)) {
            return true;
          }
        }
      }
      return false;
    };
    var parseRepeatedExtglob = (pattern, requireEnd = true) => {
      if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
        return;
      }
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let escaped = false;
      for (let i = 1; i < pattern.length; i++) {
        const ch = pattern[i];
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          continue;
        }
        if (quote === 1) {
          continue;
        }
        if (ch === "[") {
          bracket++;
          continue;
        }
        if (ch === "]" && bracket > 0) {
          bracket--;
          continue;
        }
        if (bracket > 0) {
          continue;
        }
        if (ch === "(") {
          paren++;
          continue;
        }
        if (ch === ")") {
          paren--;
          if (paren === 0) {
            if (requireEnd === true && i !== pattern.length - 1) {
              return;
            }
            return {
              type: pattern[0],
              body: pattern.slice(2, i),
              end: i
            };
          }
        }
      }
    };
    var getStarExtglobSequenceOutput = (pattern) => {
      let index = 0;
      const chars2 = [];
      while (index < pattern.length) {
        const match = parseRepeatedExtglob(pattern.slice(index), false);
        if (!match || match.type !== "*") {
          return;
        }
        const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
        if (branches.length !== 1) {
          return;
        }
        const branch = normalizeSimpleBranch(branches[0]);
        if (!branch || branch.length !== 1) {
          return;
        }
        chars2.push(branch);
        index += match.end + 1;
      }
      if (chars2.length < 1) {
        return;
      }
      const source = chars2.length === 1 ? utils.escapeRegex(chars2[0]) : `[${chars2.map((ch) => utils.escapeRegex(ch)).join("")}]`;
      return `${source}*`;
    };
    var repeatedExtglobRecursion = (pattern) => {
      let depth = 0;
      let value = pattern.trim();
      let match = parseRepeatedExtglob(value);
      while (match) {
        depth++;
        value = match.body.trim();
        match = parseRepeatedExtglob(value);
      }
      return depth;
    };
    var analyzeRepeatedExtglob = (body, options) => {
      if (options.maxExtglobRecursion === false) {
        return { risky: false };
      }
      const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
      const branches = splitTopLevel(body).map((branch) => branch.trim());
      if (branches.length > 1) {
        if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
          return { risky: true };
        }
      }
      for (const branch of branches) {
        const safeOutput = getStarExtglobSequenceOutput(branch);
        if (safeOutput) {
          return { risky: true, safeOutput };
        }
        if (repeatedExtglobRecursion(branch) > max) {
          return { risky: true };
        }
      }
      return { risky: false };
    };
    var parse2 = (input, options) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      input = REPLACEMENTS[input] || input;
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      let len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      const bos = { type: "bos", value: "", output: opts.prepend || "" };
      const tokens = [bos];
      const capture = opts.capture ? "" : "?:";
      const PLATFORM_CHARS = constants.globChars(opts.windows);
      const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
      const {
        DOT_LITERAL,
        PLUS_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOT_SLASH,
        NO_DOTS_SLASH,
        QMARK,
        QMARK_NO_DOT,
        STAR,
        START_ANCHOR
      } = PLATFORM_CHARS;
      const globstar = (opts2) => {
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const nodot = opts.dot ? "" : NO_DOT;
      const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
      let star = opts.bash === true ? globstar(opts) : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      if (typeof opts.noext === "boolean") {
        opts.noextglob = opts.noext;
      }
      const state = {
        input,
        index: -1,
        start: 0,
        dot: opts.dot === true,
        consumed: "",
        output: "",
        prefix: "",
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        quotes: 0,
        globstar: false,
        tokens
      };
      input = utils.removePrefix(input, state);
      len = input.length;
      const extglobs = [];
      const braces = [];
      const stack = [];
      let prev = bos;
      let value;
      const eos = () => state.index === len - 1;
      const peek = state.peek = (n = 1) => input[state.index + n];
      const advance = state.advance = () => input[++state.index] || "";
      const remaining = () => input.slice(state.index + 1);
      const consume = (value2 = "", num = 0) => {
        state.consumed += value2;
        state.index += num;
      };
      const append = (token) => {
        state.output += token.output != null ? token.output : token.value;
        consume(token.value);
      };
      const negate = () => {
        let count = 1;
        while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
          advance();
          state.start++;
          count++;
        }
        if (count % 2 === 0) {
          return false;
        }
        state.negated = true;
        state.start++;
        return true;
      };
      const increment = (type) => {
        state[type]++;
        stack.push(type);
      };
      const decrement = (type) => {
        state[type]--;
        stack.pop();
      };
      const push = (tok) => {
        if (prev.type === "globstar") {
          const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
          const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
          if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
            state.output = state.output.slice(0, -prev.output.length);
            prev.type = "star";
            prev.value = "*";
            prev.output = star;
            state.output += prev.output;
          }
        }
        if (extglobs.length && tok.type !== "paren") {
          extglobs[extglobs.length - 1].inner += tok.value;
        }
        if (tok.value || tok.output) append(tok);
        if (prev && prev.type === "text" && tok.type === "text") {
          prev.output = (prev.output || prev.value) + tok.value;
          prev.value += tok.value;
          return;
        }
        tok.prev = prev;
        tokens.push(tok);
        prev = tok;
      };
      const extglobOpen = (type, value2) => {
        const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
        token.prev = prev;
        token.parens = state.parens;
        token.output = state.output;
        token.startIndex = state.index;
        token.tokensIndex = tokens.length;
        const output = (opts.capture ? "(" : "") + token.open;
        increment("parens");
        push({ type, value: value2, output: state.output ? "" : ONE_CHAR });
        push({ type: "paren", extglob: true, value: advance(), output });
        extglobs.push(token);
      };
      const extglobClose = (token) => {
        const literal = input.slice(token.startIndex, state.index + 1);
        const body = input.slice(token.startIndex + 2, state.index);
        const analysis = analyzeRepeatedExtglob(body, opts);
        if ((token.type === "plus" || token.type === "star") && analysis.risky) {
          const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
          const open = tokens[token.tokensIndex];
          open.type = "text";
          open.value = literal;
          open.output = safeOutput || utils.escapeRegex(literal);
          for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
            tokens[i].value = "";
            tokens[i].output = "";
            delete tokens[i].suffix;
          }
          state.output = token.output + open.output;
          state.backtrack = true;
          push({ type: "paren", extglob: true, value, output: "" });
          decrement("parens");
          return;
        }
        let output = token.close + (opts.capture ? ")" : "");
        let rest;
        if (token.type === "negate") {
          let extglobStar = star;
          if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
            extglobStar = globstar(opts);
          }
          if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
            output = token.close = `)$))${extglobStar}`;
          }
          if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
            const expression = parse2(rest, { ...options, fastpaths: false }).output;
            output = token.close = `)${expression})${extglobStar})`;
          }
          if (token.prev.type === "bos") {
            state.negatedExtglob = true;
          }
        }
        push({ type: "paren", extglob: true, value, output });
        decrement("parens");
      };
      if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
        let backslashes = false;
        let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars2, first, rest, index) => {
          if (first === "\\") {
            backslashes = true;
            return m;
          }
          if (first === "?") {
            if (esc) {
              return esc + first + (rest ? QMARK.repeat(rest.length) : "");
            }
            if (index === 0) {
              return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
            }
            return QMARK.repeat(chars2.length);
          }
          if (first === ".") {
            return DOT_LITERAL.repeat(chars2.length);
          }
          if (first === "*") {
            if (esc) {
              return esc + first + (rest ? star : "");
            }
            return star;
          }
          return esc ? m : `\\${m}`;
        });
        if (backslashes === true) {
          if (opts.unescape === true) {
            output = output.replace(/\\/g, "");
          } else {
            output = output.replace(/\\+/g, (m) => {
              return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
            });
          }
        }
        if (output === input && opts.contains === true) {
          state.output = input;
          return state;
        }
        state.output = utils.wrapOutput(output, state, options);
        return state;
      }
      while (!eos()) {
        value = advance();
        if (value === "\0") {
          continue;
        }
        if (value === "\\") {
          const next = peek();
          if (next === "/" && opts.bash !== true) {
            continue;
          }
          if (next === "." || next === ";") {
            continue;
          }
          if (!next) {
            value += "\\";
            push({ type: "text", value });
            continue;
          }
          const match = /^\\+/.exec(remaining());
          let slashes = 0;
          if (match && match[0].length > 2) {
            slashes = match[0].length;
            state.index += slashes;
            if (slashes % 2 !== 0) {
              value += "\\";
            }
          }
          if (opts.unescape === true) {
            value = advance();
          } else {
            value += advance();
          }
          if (state.brackets === 0) {
            push({ type: "text", value });
            continue;
          }
        }
        if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
          if (opts.posix !== false && value === ":") {
            const inner = prev.value.slice(1);
            if (inner.includes("[")) {
              prev.posix = true;
              if (inner.includes(":")) {
                const idx = prev.value.lastIndexOf("[");
                const pre = prev.value.slice(0, idx);
                const rest2 = prev.value.slice(idx + 2);
                const posix2 = POSIX_REGEX_SOURCE[rest2];
                if (posix2) {
                  prev.value = pre + posix2;
                  state.backtrack = true;
                  advance();
                  if (!bos.output && tokens.indexOf(prev) === 1) {
                    bos.output = ONE_CHAR;
                  }
                  continue;
                }
              }
            }
          }
          if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
            value = `\\${value}`;
          }
          if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
            value = `\\${value}`;
          }
          if (opts.posix === true && value === "!" && prev.value === "[") {
            value = "^";
          }
          prev.value += value;
          append({ value });
          continue;
        }
        if (state.quotes === 1 && value !== '"') {
          value = utils.escapeRegex(value);
          prev.value += value;
          append({ value });
          continue;
        }
        if (value === '"') {
          state.quotes = state.quotes === 1 ? 0 : 1;
          if (opts.keepQuotes === true) {
            push({ type: "text", value });
          }
          continue;
        }
        if (value === "(") {
          increment("parens");
          push({ type: "paren", value });
          continue;
        }
        if (value === ")") {
          if (state.parens === 0 && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "("));
          }
          const extglob = extglobs[extglobs.length - 1];
          if (extglob && state.parens === extglob.parens + 1) {
            extglobClose(extglobs.pop());
            continue;
          }
          push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
          decrement("parens");
          continue;
        }
        if (value === "[") {
          if (opts.nobracket === true || !remaining().includes("]")) {
            if (opts.nobracket !== true && opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("closing", "]"));
            }
            value = `\\${value}`;
          } else {
            increment("brackets");
          }
          push({ type: "bracket", value });
          continue;
        }
        if (value === "]") {
          if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          if (state.brackets === 0) {
            if (opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("opening", "["));
            }
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          decrement("brackets");
          const prevValue = prev.value.slice(1);
          if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
            value = `/${value}`;
          }
          prev.value += value;
          append({ value });
          if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
            continue;
          }
          const escaped = utils.escapeRegex(prev.value);
          state.output = state.output.slice(0, -prev.value.length);
          if (opts.literalBrackets === true) {
            state.output += escaped;
            prev.value = escaped;
            continue;
          }
          prev.value = `(${capture}${escaped}|${prev.value})`;
          state.output += prev.value;
          continue;
        }
        if (value === "{" && opts.nobrace !== true) {
          increment("braces");
          const open = {
            type: "brace",
            value,
            output: "(",
            outputIndex: state.output.length,
            tokensIndex: state.tokens.length
          };
          braces.push(open);
          push(open);
          continue;
        }
        if (value === "}") {
          const brace = braces[braces.length - 1];
          if (opts.nobrace === true || !brace) {
            push({ type: "text", value, output: value });
            continue;
          }
          let output = ")";
          if (brace.dots === true) {
            const arr = tokens.slice();
            const range = [];
            for (let i = arr.length - 1; i >= 0; i--) {
              tokens.pop();
              if (arr[i].type === "brace") {
                break;
              }
              if (arr[i].type !== "dots") {
                range.unshift(arr[i].value);
              }
            }
            output = expandRange(range, opts);
            state.backtrack = true;
          }
          if (brace.comma !== true && brace.dots !== true) {
            const out = state.output.slice(0, brace.outputIndex);
            const toks = state.tokens.slice(brace.tokensIndex);
            brace.value = brace.output = "\\{";
            value = output = "\\}";
            state.output = out;
            for (const t of toks) {
              state.output += t.output || t.value;
            }
          }
          push({ type: "brace", value, output });
          decrement("braces");
          braces.pop();
          continue;
        }
        if (value === "|") {
          if (extglobs.length > 0) {
            extglobs[extglobs.length - 1].conditions++;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === ",") {
          let output = value;
          const brace = braces[braces.length - 1];
          if (brace && stack[stack.length - 1] === "braces") {
            brace.comma = true;
            output = "|";
          }
          push({ type: "comma", value, output });
          continue;
        }
        if (value === "/") {
          if (prev.type === "dot" && state.index === state.start + 1) {
            state.start = state.index + 1;
            state.consumed = "";
            state.output = "";
            tokens.pop();
            prev = bos;
            continue;
          }
          push({ type: "slash", value, output: SLASH_LITERAL });
          continue;
        }
        if (value === ".") {
          if (state.braces > 0 && prev.type === "dot") {
            if (prev.value === ".") prev.output = DOT_LITERAL;
            const brace = braces[braces.length - 1];
            prev.type = "dots";
            prev.output += value;
            prev.value += value;
            brace.dots = true;
            continue;
          }
          if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
            push({ type: "text", value, output: DOT_LITERAL });
            continue;
          }
          push({ type: "dot", value, output: DOT_LITERAL });
          continue;
        }
        if (value === "?") {
          const isGroup = prev && prev.value === "(";
          if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("qmark", value);
            continue;
          }
          if (prev && prev.type === "paren") {
            const next = peek();
            let output = value;
            if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
              output = `\\${value}`;
            }
            push({ type: "text", value, output });
            continue;
          }
          if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
            push({ type: "qmark", value, output: QMARK_NO_DOT });
            continue;
          }
          push({ type: "qmark", value, output: QMARK });
          continue;
        }
        if (value === "!") {
          if (opts.noextglob !== true && peek() === "(") {
            if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
              extglobOpen("negate", value);
              continue;
            }
          }
          if (opts.nonegate !== true && state.index === 0) {
            negate();
            continue;
          }
        }
        if (value === "+") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("plus", value);
            continue;
          }
          if (prev && prev.value === "(" || opts.regex === false) {
            push({ type: "plus", value, output: PLUS_LITERAL });
            continue;
          }
          if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
            push({ type: "plus", value });
            continue;
          }
          push({ type: "plus", value: PLUS_LITERAL });
          continue;
        }
        if (value === "@") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            push({ type: "at", extglob: true, value, output: "" });
            continue;
          }
          push({ type: "text", value });
          continue;
        }
        if (value !== "*") {
          if (value === "$" || value === "^") {
            value = `\\${value}`;
          }
          const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
          if (match) {
            value += match[0];
            state.index += match[0].length;
          }
          push({ type: "text", value });
          continue;
        }
        if (prev && (prev.type === "globstar" || prev.star === true)) {
          prev.type = "star";
          prev.star = true;
          prev.value += value;
          prev.output = star;
          state.backtrack = true;
          state.globstar = true;
          consume(value);
          continue;
        }
        let rest = remaining();
        if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
          extglobOpen("star", value);
          continue;
        }
        if (prev.type === "star") {
          if (opts.noglobstar === true) {
            consume(value);
            continue;
          }
          const prior = prev.prev;
          const before = prior.prev;
          const isStart = prior.type === "slash" || prior.type === "bos";
          const afterStar = before && (before.type === "star" || before.type === "globstar");
          if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
            push({ type: "star", value, output: "" });
            continue;
          }
          const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
          const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
          if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
            push({ type: "star", value, output: "" });
            continue;
          }
          while (rest.slice(0, 3) === "/**") {
            const after = input[state.index + 4];
            if (after && after !== "/") {
              break;
            }
            rest = rest.slice(3);
            consume("/**", 3);
          }
          if (prior.type === "bos" && eos()) {
            prev.type = "globstar";
            prev.value += value;
            prev.output = globstar(opts);
            state.output = prev.output;
            state.globstar = true;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
            prev.value += value;
            state.globstar = true;
            state.output += prior.output + prev.output;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
            const end = rest[1] !== void 0 ? "|$" : "";
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
            prev.value += value;
            state.output += prior.output + prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          if (prior.type === "bos" && rest[0] === "/") {
            prev.type = "globstar";
            prev.value += value;
            prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
            state.output = prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "globstar";
          prev.output = globstar(opts);
          prev.value += value;
          state.output += prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        const token = { type: "star", value, output: star };
        if (opts.bash === true) {
          token.output = ".*?";
          if (prev.type === "bos" || prev.type === "slash") {
            token.output = nodot + token.output;
          }
          push(token);
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
          token.output = value;
          push(token);
          continue;
        }
        if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
          if (prev.type === "dot") {
            state.output += NO_DOT_SLASH;
            prev.output += NO_DOT_SLASH;
          } else if (opts.dot === true) {
            state.output += NO_DOTS_SLASH;
            prev.output += NO_DOTS_SLASH;
          } else {
            state.output += nodot;
            prev.output += nodot;
          }
          if (peek() !== "*") {
            state.output += ONE_CHAR;
            prev.output += ONE_CHAR;
          }
        }
        push(token);
      }
      while (state.brackets > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
        state.output = utils.escapeLast(state.output, "[");
        decrement("brackets");
      }
      while (state.parens > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
        state.output = utils.escapeLast(state.output, "(");
        decrement("parens");
      }
      while (state.braces > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
        state.output = utils.escapeLast(state.output, "{");
        decrement("braces");
      }
      if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
        push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
      }
      if (state.backtrack === true) {
        state.output = "";
        for (const token of state.tokens) {
          state.output += token.output != null ? token.output : token.value;
          if (token.suffix) {
            state.output += token.suffix;
          }
        }
      }
      return state;
    };
    parse2.fastpaths = (input, options) => {
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      const len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      input = REPLACEMENTS[input] || input;
      const {
        DOT_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOTS,
        NO_DOTS_SLASH,
        STAR,
        START_ANCHOR
      } = constants.globChars(opts.windows);
      const nodot = opts.dot ? NO_DOTS : NO_DOT;
      const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
      const capture = opts.capture ? "" : "?:";
      const state = { negated: false, prefix: "" };
      let star = opts.bash === true ? ".*?" : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      const globstar = (opts2) => {
        if (opts2.noglobstar === true) return star;
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const create = (str) => {
        switch (str) {
          case "*":
            return `${nodot}${ONE_CHAR}${star}`;
          case ".*":
            return `${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*.*":
            return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*/*":
            return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
          case "**":
            return nodot + globstar(opts);
          case "**/*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
          case "**/*.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "**/.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
          default: {
            const match = /^(.*?)\.(\w+)$/.exec(str);
            if (!match) return;
            const source2 = create(match[1]);
            if (!source2) return;
            return source2 + DOT_LITERAL + match[2];
          }
        }
      };
      const output = utils.removePrefix(input, state);
      let source = create(output);
      if (source && opts.strictSlashes !== true) {
        source += `${SLASH_LITERAL}?`;
      }
      return source;
    };
    module.exports = parse2;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/lib/picomatch.js"(exports, module) {
    "use strict";
    var scan = require_scan();
    var parse2 = require_parse();
    var utils = require_utils();
    var constants = require_constants();
    var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
    var picomatch2 = (glob2, options, returnState = false) => {
      if (Array.isArray(glob2)) {
        const fns = glob2.map((input) => picomatch2(input, options, returnState));
        const arrayMatcher = (str) => {
          for (const isMatch of fns) {
            const state2 = isMatch(str);
            if (state2) return state2;
          }
          return false;
        };
        return arrayMatcher;
      }
      const isState = isObject(glob2) && glob2.tokens && glob2.input;
      if (glob2 === "" || typeof glob2 !== "string" && !isState) {
        throw new TypeError("Expected pattern to be a non-empty string");
      }
      const opts = options || {};
      const posix2 = opts.windows;
      const regex = isState ? picomatch2.compileRe(glob2, options) : picomatch2.makeRe(glob2, options, false, true);
      const state = regex.state;
      delete regex.state;
      let isIgnored = () => false;
      if (opts.ignore) {
        const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
        isIgnored = picomatch2(opts.ignore, ignoreOpts, returnState);
      }
      const matcher = (input, returnObject = false) => {
        const { isMatch, match, output } = picomatch2.test(input, regex, options, { glob: glob2, posix: posix2 });
        const result = { glob: glob2, state, regex, posix: posix2, input, output, match, isMatch };
        if (typeof opts.onResult === "function") {
          opts.onResult(result);
        }
        if (isMatch === false) {
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (isIgnored(input)) {
          if (typeof opts.onIgnore === "function") {
            opts.onIgnore(result);
          }
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (typeof opts.onMatch === "function") {
          opts.onMatch(result);
        }
        return returnObject ? result : true;
      };
      if (returnState) {
        matcher.state = state;
      }
      return matcher;
    };
    picomatch2.test = (input, regex, options, { glob: glob2, posix: posix2 } = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected input to be a string");
      }
      if (input === "") {
        return { isMatch: false, output: "" };
      }
      const opts = options || {};
      const format = opts.format || (posix2 ? utils.toPosixSlashes : null);
      let match = input === glob2;
      let output = match && format ? format(input) : input;
      if (match === false) {
        output = format ? format(input) : input;
        match = output === glob2;
      }
      if (match === false || opts.capture === true) {
        if (opts.matchBase === true || opts.basename === true) {
          match = picomatch2.matchBase(input, regex, options, posix2);
        } else {
          match = regex.exec(output);
        }
      }
      return { isMatch: Boolean(match), match, output };
    };
    picomatch2.matchBase = (input, glob2, options) => {
      const regex = glob2 instanceof RegExp ? glob2 : picomatch2.makeRe(glob2, options);
      return regex.test(utils.basename(input));
    };
    picomatch2.isMatch = (str, patterns, options) => picomatch2(patterns, options)(str);
    picomatch2.parse = (pattern, options) => {
      if (Array.isArray(pattern)) return pattern.map((p) => picomatch2.parse(p, options));
      return parse2(pattern, { ...options, fastpaths: false });
    };
    picomatch2.scan = (input, options) => scan(input, options);
    picomatch2.compileRe = (state, options, returnOutput = false, returnState = false) => {
      if (returnOutput === true) {
        return state.output;
      }
      const opts = options || {};
      const prepend = opts.contains ? "" : "^";
      const append = opts.contains ? "" : "$";
      let source = `${prepend}(?:${state.output})${append}`;
      if (state && state.negated === true) {
        source = `^(?!${source}).*$`;
      }
      const regex = picomatch2.toRegex(source, options);
      if (returnState === true) {
        regex.state = state;
      }
      return regex;
    };
    picomatch2.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
      if (!input || typeof input !== "string") {
        throw new TypeError("Expected a non-empty string");
      }
      let parsed = { negated: false, fastpaths: true };
      if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
        parsed.output = parse2.fastpaths(input, options);
      }
      if (!parsed.output) {
        parsed = parse2(input, options);
      }
      return picomatch2.compileRe(parsed, options, returnOutput, returnState);
    };
    picomatch2.toRegex = (source, options) => {
      try {
        const opts = options || {};
        return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
      } catch (err) {
        if (options && options.debug === true) throw err;
        return /$^/;
      }
    };
    picomatch2.constants = constants;
    module.exports = picomatch2;
  }
});

// ../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS({
  "../../node_modules/.pnpm/picomatch@4.0.4/node_modules/picomatch/index.js"(exports, module) {
    "use strict";
    var pico = require_picomatch();
    var utils = require_utils();
    function picomatch2(glob2, options, returnState = false) {
      if (options && (options.windows === null || options.windows === void 0)) {
        options = { ...options, windows: utils.isWindows() };
      }
      return pico(glob2, options, returnState);
    }
    Object.assign(picomatch2, pico);
    module.exports = picomatch2;
  }
});

// bin/quality-runner.ts
import { join as join4 } from "node:path";

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
function decodeInteger(reader, relative2) {
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
  return relative2 + value;
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
    const resolve7 = resolver(mapUrl, sourceRoot);
    this.resolvedSources = sources.map(resolve7);
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

// lib/env.ts
import { resolve as resolve2 } from "node:path";
import { readFileSync, existsSync as existsSync2 } from "node:fs";
function loadEnvFile(filePath) {
  if (!existsSync2(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === void 0) {
      process.env[key] = value;
    }
  }
}
function loadEnv() {
  const cwd = process.cwd();
  loadEnvFile(resolve2(cwd, ".env.local"));
  loadEnvFile(resolve2(cwd, ".env.dev"));
  loadEnvFile(resolve2(cwd, ".env"));
}

// lib/quality-core-bridge.ts
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
var cachedCore;
async function loadRunnerCore(projectDir) {
  if (cachedCore !== void 0) return cachedCore;
  const projectRequire = createRequire(join(projectDir, "package.json"));
  let resolved;
  try {
    resolved = projectRequire.resolve("@crux/core/quality/internal/runner");
  } catch {
    throw new Error(
      `@crux/core is not resolvable from ${projectDir} \u2014 the quality runner needs the project to depend on @crux/core.`
    );
  }
  cachedCore = await import(pathToFileURL(resolved).href);
  return cachedCore;
}

// lib/quality-config.ts
import { existsSync as existsSync3 } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname as dirname3, isAbsolute, join as join2, resolve as resolve3 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";
var CONFIG_NAMES = ["crux.config.ts", "crux.config.js", "crux.config.mjs"];
function findQualityConfigFile(startDir) {
  let dir = resolve3(startDir);
  for (; ; ) {
    for (const name of CONFIG_NAMES) {
      const candidate = join2(dir, name);
      if (existsSync3(candidate)) return candidate;
    }
    const parent = dirname3(dir);
    if (parent === dir) return void 0;
    dir = parent;
  }
}
function isCruxInstance(value) {
  return value != null && typeof value === "object" && "config" in value && "prompts" in value && typeof value.get === "function";
}
async function loadQualityProject(configPath) {
  const absPath = configPath ? resolve3(process.cwd(), configPath) : findQualityConfigFile(process.cwd());
  if (!absPath) {
    throw new Error("No crux.config.ts found. Create one at your project root or use --config <path>.");
  }
  const configDir = dirname3(absPath);
  const configModule = await import(pathToFileURL2(absPath).href);
  const exported = configModule.default ?? configModule;
  if (!isCruxInstance(exported)) {
    throw new Error(`${absPath} does not export a Crux config \u2014 export default config({ ... }).`);
  }
  return {
    quality: exported.config.quality ?? {},
    prompts: exported.prompts,
    configDir,
    configPath: absPath
  };
}
function resolveQualityRunnerSettings(quality, configDir) {
  const include = quality.include === void 0 ? ["**/*.eval.ts"] : toArray(quality.include);
  const dir = quality.dir === void 0 ? join2(configDir, ".crux/quality") : absolutize(quality.dir, configDir);
  return {
    include,
    exclude: toArray(quality.exclude ?? []),
    dir,
    qualityId: quality.id,
    redact: [...quality.redact ?? []],
    defaults: { ...quality.defaults },
    setup: quality.setup
  };
}
function toArray(value) {
  return typeof value === "string" ? [value] : [...value];
}
function absolutize(path, base) {
  return isAbsolute(path) ? path : join2(base, path);
}
var GITIGNORE_CONTENT = `# Crux Quality \u2014 machine-local artifacts (baselines/ and cassettes/ are committed)
experiments/
cache/
`;
async function ensureQualityGitignore(dir) {
  const path = join2(dir, ".gitignore");
  if (existsSync3(path)) return;
  await mkdir(dir, { recursive: true });
  await writeFile(path, GITIGNORE_CONTENT, "utf8");
}

// lib/quality-collect.ts
import { resolve as resolve6 } from "node:path";
import { pathToFileURL as pathToFileURL3 } from "node:url";

// ../../node_modules/.pnpm/tinyglobby@0.2.16/node_modules/tinyglobby/dist/index.mjs
import { readdir, readdirSync, realpath, realpathSync, stat, statSync } from "fs";
import { isAbsolute as isAbsolute2, posix, resolve as resolve5 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// ../../node_modules/.pnpm/fdir@6.5.0_picomatch@4.0.4/node_modules/fdir/dist/index.mjs
import { createRequire as createRequire2 } from "module";
import { basename, dirname as dirname4, normalize, relative, resolve as resolve4, sep } from "path";
import * as nativeFs from "fs";
var __require = /* @__PURE__ */ createRequire2(import.meta.url);
function cleanPath(path) {
  let normalized = normalize(path);
  if (normalized.length > 1 && normalized[normalized.length - 1] === sep) normalized = normalized.substring(0, normalized.length - 1);
  return normalized;
}
var SLASHES_REGEX = /[\\/]/g;
function convertSlashes(path, separator) {
  return path.replace(SLASHES_REGEX, separator);
}
var WINDOWS_ROOT_DIR_REGEX = /^[a-z]:[\\/]$/i;
function isRootDirectory(path) {
  return path === "/" || WINDOWS_ROOT_DIR_REGEX.test(path);
}
function normalizePath3(path, options) {
  const { resolvePaths, normalizePath: normalizePath$1, pathSeparator } = options;
  const pathNeedsCleaning = process.platform === "win32" && path.includes("/") || path.startsWith(".");
  if (resolvePaths) path = resolve4(path);
  if (normalizePath$1 || pathNeedsCleaning) path = cleanPath(path);
  if (path === ".") return "";
  const needsSeperator = path[path.length - 1] !== pathSeparator;
  return convertSlashes(needsSeperator ? path + pathSeparator : path, pathSeparator);
}
function joinPathWithBasePath(filename, directoryPath) {
  return directoryPath + filename;
}
function joinPathWithRelativePath(root, options) {
  return function(filename, directoryPath) {
    const sameRoot = directoryPath.startsWith(root);
    if (sameRoot) return directoryPath.slice(root.length) + filename;
    else return convertSlashes(relative(root, directoryPath), options.pathSeparator) + options.pathSeparator + filename;
  };
}
function joinPath(filename) {
  return filename;
}
function joinDirectoryPath(filename, directoryPath, separator) {
  return directoryPath + filename + separator;
}
function build$7(root, options) {
  const { relativePaths, includeBasePath } = options;
  return relativePaths && root ? joinPathWithRelativePath(root, options) : includeBasePath ? joinPathWithBasePath : joinPath;
}
function pushDirectoryWithRelativePath(root) {
  return function(directoryPath, paths) {
    paths.push(directoryPath.substring(root.length) || ".");
  };
}
function pushDirectoryFilterWithRelativePath(root) {
  return function(directoryPath, paths, filters) {
    const relativePath = directoryPath.substring(root.length) || ".";
    if (filters.every((filter) => filter(relativePath, true))) paths.push(relativePath);
  };
}
var pushDirectory = (directoryPath, paths) => {
  paths.push(directoryPath || ".");
};
var pushDirectoryFilter = (directoryPath, paths, filters) => {
  const path = directoryPath || ".";
  if (filters.every((filter) => filter(path, true))) paths.push(path);
};
var empty$2 = () => {
};
function build$6(root, options) {
  const { includeDirs, filters, relativePaths } = options;
  if (!includeDirs) return empty$2;
  if (relativePaths) return filters && filters.length ? pushDirectoryFilterWithRelativePath(root) : pushDirectoryWithRelativePath(root);
  return filters && filters.length ? pushDirectoryFilter : pushDirectory;
}
var pushFileFilterAndCount = (filename, _paths, counts, filters) => {
  if (filters.every((filter) => filter(filename, false))) counts.files++;
};
var pushFileFilter = (filename, paths, _counts, filters) => {
  if (filters.every((filter) => filter(filename, false))) paths.push(filename);
};
var pushFileCount = (_filename, _paths, counts, _filters) => {
  counts.files++;
};
var pushFile = (filename, paths) => {
  paths.push(filename);
};
var empty$1 = () => {
};
function build$5(options) {
  const { excludeFiles, filters, onlyCounts } = options;
  if (excludeFiles) return empty$1;
  if (filters && filters.length) return onlyCounts ? pushFileFilterAndCount : pushFileFilter;
  else if (onlyCounts) return pushFileCount;
  else return pushFile;
}
var getArray = (paths) => {
  return paths;
};
var getArrayGroup = () => {
  return [""].slice(0, 0);
};
function build$4(options) {
  return options.group ? getArrayGroup : getArray;
}
var groupFiles = (groups, directory, files) => {
  groups.push({
    directory,
    files,
    dir: directory
  });
};
var empty = () => {
};
function build$3(options) {
  return options.group ? groupFiles : empty;
}
var resolveSymlinksAsync = function(path, state, callback$1) {
  const { queue, fs, options: { suppressErrors } } = state;
  queue.enqueue();
  fs.realpath(path, (error, resolvedPath) => {
    if (error) return queue.dequeue(suppressErrors ? null : error, state);
    fs.stat(resolvedPath, (error$1, stat2) => {
      if (error$1) return queue.dequeue(suppressErrors ? null : error$1, state);
      if (stat2.isDirectory() && isRecursive(path, resolvedPath, state)) return queue.dequeue(null, state);
      callback$1(stat2, resolvedPath);
      queue.dequeue(null, state);
    });
  });
};
var resolveSymlinks = function(path, state, callback$1) {
  const { queue, fs, options: { suppressErrors } } = state;
  queue.enqueue();
  try {
    const resolvedPath = fs.realpathSync(path);
    const stat2 = fs.statSync(resolvedPath);
    if (stat2.isDirectory() && isRecursive(path, resolvedPath, state)) return;
    callback$1(stat2, resolvedPath);
  } catch (e) {
    if (!suppressErrors) throw e;
  }
};
function build$2(options, isSynchronous) {
  if (!options.resolveSymlinks || options.excludeSymlinks) return null;
  return isSynchronous ? resolveSymlinks : resolveSymlinksAsync;
}
function isRecursive(path, resolved, state) {
  if (state.options.useRealPaths) return isRecursiveUsingRealPaths(resolved, state);
  let parent = dirname4(path);
  let depth = 1;
  while (parent !== state.root && depth < 2) {
    const resolvedPath = state.symlinks.get(parent);
    const isSameRoot = !!resolvedPath && (resolvedPath === resolved || resolvedPath.startsWith(resolved) || resolved.startsWith(resolvedPath));
    if (isSameRoot) depth++;
    else parent = dirname4(parent);
  }
  state.symlinks.set(path, resolved);
  return depth > 1;
}
function isRecursiveUsingRealPaths(resolved, state) {
  return state.visited.includes(resolved + state.options.pathSeparator);
}
var onlyCountsSync = (state) => {
  return state.counts;
};
var groupsSync = (state) => {
  return state.groups;
};
var defaultSync = (state) => {
  return state.paths;
};
var limitFilesSync = (state) => {
  return state.paths.slice(0, state.options.maxFiles);
};
var onlyCountsAsync = (state, error, callback$1) => {
  report(error, callback$1, state.counts, state.options.suppressErrors);
  return null;
};
var defaultAsync = (state, error, callback$1) => {
  report(error, callback$1, state.paths, state.options.suppressErrors);
  return null;
};
var limitFilesAsync = (state, error, callback$1) => {
  report(error, callback$1, state.paths.slice(0, state.options.maxFiles), state.options.suppressErrors);
  return null;
};
var groupsAsync = (state, error, callback$1) => {
  report(error, callback$1, state.groups, state.options.suppressErrors);
  return null;
};
function report(error, callback$1, output, suppressErrors) {
  if (error && !suppressErrors) callback$1(error, output);
  else callback$1(null, output);
}
function build$1(options, isSynchronous) {
  const { onlyCounts, group, maxFiles } = options;
  if (onlyCounts) return isSynchronous ? onlyCountsSync : onlyCountsAsync;
  else if (group) return isSynchronous ? groupsSync : groupsAsync;
  else if (maxFiles) return isSynchronous ? limitFilesSync : limitFilesAsync;
  else return isSynchronous ? defaultSync : defaultAsync;
}
var readdirOpts = { withFileTypes: true };
var walkAsync = (state, crawlPath, directoryPath, currentDepth, callback$1) => {
  state.queue.enqueue();
  if (currentDepth < 0) return state.queue.dequeue(null, state);
  const { fs } = state;
  state.visited.push(crawlPath);
  state.counts.directories++;
  fs.readdir(crawlPath || ".", readdirOpts, (error, entries = []) => {
    callback$1(entries, directoryPath, currentDepth);
    state.queue.dequeue(state.options.suppressErrors ? null : error, state);
  });
};
var walkSync = (state, crawlPath, directoryPath, currentDepth, callback$1) => {
  const { fs } = state;
  if (currentDepth < 0) return;
  state.visited.push(crawlPath);
  state.counts.directories++;
  let entries = [];
  try {
    entries = fs.readdirSync(crawlPath || ".", readdirOpts);
  } catch (e) {
    if (!state.options.suppressErrors) throw e;
  }
  callback$1(entries, directoryPath, currentDepth);
};
function build(isSynchronous) {
  return isSynchronous ? walkSync : walkAsync;
}
var Queue = class {
  count = 0;
  constructor(onQueueEmpty) {
    this.onQueueEmpty = onQueueEmpty;
  }
  enqueue() {
    this.count++;
    return this.count;
  }
  dequeue(error, output) {
    if (this.onQueueEmpty && (--this.count <= 0 || error)) {
      this.onQueueEmpty(error, output);
      if (error) {
        output.controller.abort();
        this.onQueueEmpty = void 0;
      }
    }
  }
};
var Counter = class {
  _files = 0;
  _directories = 0;
  set files(num) {
    this._files = num;
  }
  get files() {
    return this._files;
  }
  set directories(num) {
    this._directories = num;
  }
  get directories() {
    return this._directories;
  }
  /**
  * @deprecated use `directories` instead
  */
  /* c8 ignore next 3 */
  get dirs() {
    return this._directories;
  }
};
var Aborter = class {
  aborted = false;
  abort() {
    this.aborted = true;
  }
};
var Walker = class {
  root;
  isSynchronous;
  state;
  joinPath;
  pushDirectory;
  pushFile;
  getArray;
  groupFiles;
  resolveSymlink;
  walkDirectory;
  callbackInvoker;
  constructor(root, options, callback$1) {
    this.isSynchronous = !callback$1;
    this.callbackInvoker = build$1(options, this.isSynchronous);
    this.root = normalizePath3(root, options);
    this.state = {
      root: isRootDirectory(this.root) ? this.root : this.root.slice(0, -1),
      paths: [""].slice(0, 0),
      groups: [],
      counts: new Counter(),
      options,
      queue: new Queue((error, state) => this.callbackInvoker(state, error, callback$1)),
      symlinks: /* @__PURE__ */ new Map(),
      visited: [""].slice(0, 0),
      controller: new Aborter(),
      fs: options.fs || nativeFs
    };
    this.joinPath = build$7(this.root, options);
    this.pushDirectory = build$6(this.root, options);
    this.pushFile = build$5(options);
    this.getArray = build$4(options);
    this.groupFiles = build$3(options);
    this.resolveSymlink = build$2(options, this.isSynchronous);
    this.walkDirectory = build(this.isSynchronous);
  }
  start() {
    this.pushDirectory(this.root, this.state.paths, this.state.options.filters);
    this.walkDirectory(this.state, this.root, this.root, this.state.options.maxDepth, this.walk);
    return this.isSynchronous ? this.callbackInvoker(this.state, null) : null;
  }
  walk = (entries, directoryPath, depth) => {
    const { paths, options: { filters, resolveSymlinks: resolveSymlinks$1, excludeSymlinks, exclude, maxFiles, signal, useRealPaths, pathSeparator }, controller } = this.state;
    if (controller.aborted || signal && signal.aborted || maxFiles && paths.length > maxFiles) return;
    const files = this.getArray(this.state.paths);
    for (let i = 0; i < entries.length; ++i) {
      const entry = entries[i];
      if (entry.isFile() || entry.isSymbolicLink() && !resolveSymlinks$1 && !excludeSymlinks) {
        const filename = this.joinPath(entry.name, directoryPath);
        this.pushFile(filename, files, this.state.counts, filters);
      } else if (entry.isDirectory()) {
        let path = joinDirectoryPath(entry.name, directoryPath, this.state.options.pathSeparator);
        if (exclude && exclude(entry.name, path)) continue;
        this.pushDirectory(path, paths, filters);
        this.walkDirectory(this.state, path, path, depth - 1, this.walk);
      } else if (this.resolveSymlink && entry.isSymbolicLink()) {
        let path = joinPathWithBasePath(entry.name, directoryPath);
        this.resolveSymlink(path, this.state, (stat2, resolvedPath) => {
          if (stat2.isDirectory()) {
            resolvedPath = normalizePath3(resolvedPath, this.state.options);
            if (exclude && exclude(entry.name, useRealPaths ? resolvedPath : path + pathSeparator)) return;
            this.walkDirectory(this.state, resolvedPath, useRealPaths ? resolvedPath : path + pathSeparator, depth - 1, this.walk);
          } else {
            resolvedPath = useRealPaths ? resolvedPath : path;
            const filename = basename(resolvedPath);
            const directoryPath$1 = normalizePath3(dirname4(resolvedPath), this.state.options);
            resolvedPath = this.joinPath(filename, directoryPath$1);
            this.pushFile(resolvedPath, files, this.state.counts, filters);
          }
        });
      }
    }
    this.groupFiles(this.state.groups, directoryPath, files);
  };
};
function promise(root, options) {
  return new Promise((resolve$1, reject) => {
    callback(root, options, (err, output) => {
      if (err) return reject(err);
      resolve$1(output);
    });
  });
}
function callback(root, options, callback$1) {
  let walker = new Walker(root, options, callback$1);
  walker.start();
}
function sync(root, options) {
  const walker = new Walker(root, options);
  return walker.start();
}
var APIBuilder = class {
  constructor(root, options) {
    this.root = root;
    this.options = options;
  }
  withPromise() {
    return promise(this.root, this.options);
  }
  withCallback(cb) {
    callback(this.root, this.options, cb);
  }
  sync() {
    return sync(this.root, this.options);
  }
};
var pm = null;
try {
  __require.resolve("picomatch");
  pm = __require("picomatch");
} catch {
}
var Builder = class {
  globCache = {};
  options = {
    maxDepth: Infinity,
    suppressErrors: true,
    pathSeparator: sep,
    filters: []
  };
  globFunction;
  constructor(options) {
    this.options = {
      ...this.options,
      ...options
    };
    this.globFunction = this.options.globFunction;
  }
  group() {
    this.options.group = true;
    return this;
  }
  withPathSeparator(separator) {
    this.options.pathSeparator = separator;
    return this;
  }
  withBasePath() {
    this.options.includeBasePath = true;
    return this;
  }
  withRelativePaths() {
    this.options.relativePaths = true;
    return this;
  }
  withDirs() {
    this.options.includeDirs = true;
    return this;
  }
  withMaxDepth(depth) {
    this.options.maxDepth = depth;
    return this;
  }
  withMaxFiles(limit) {
    this.options.maxFiles = limit;
    return this;
  }
  withFullPaths() {
    this.options.resolvePaths = true;
    this.options.includeBasePath = true;
    return this;
  }
  withErrors() {
    this.options.suppressErrors = false;
    return this;
  }
  withSymlinks({ resolvePaths = true } = {}) {
    this.options.resolveSymlinks = true;
    this.options.useRealPaths = resolvePaths;
    return this.withFullPaths();
  }
  withAbortSignal(signal) {
    this.options.signal = signal;
    return this;
  }
  normalize() {
    this.options.normalizePath = true;
    return this;
  }
  filter(predicate) {
    this.options.filters.push(predicate);
    return this;
  }
  onlyDirs() {
    this.options.excludeFiles = true;
    this.options.includeDirs = true;
    return this;
  }
  exclude(predicate) {
    this.options.exclude = predicate;
    return this;
  }
  onlyCounts() {
    this.options.onlyCounts = true;
    return this;
  }
  crawl(root) {
    return new APIBuilder(root || ".", this.options);
  }
  withGlobFunction(fn) {
    this.globFunction = fn;
    return this;
  }
  /**
  * @deprecated Pass options using the constructor instead:
  * ```ts
  * new fdir(options).crawl("/path/to/root");
  * ```
  * This method will be removed in v7.0
  */
  /* c8 ignore next 4 */
  crawlWithOptions(root, options) {
    this.options = {
      ...this.options,
      ...options
    };
    return new APIBuilder(root || ".", this.options);
  }
  glob(...patterns) {
    if (this.globFunction) return this.globWithOptions(patterns);
    return this.globWithOptions(patterns, ...[{ dot: true }]);
  }
  globWithOptions(patterns, ...options) {
    const globFn = this.globFunction || pm;
    if (!globFn) throw new Error("Please specify a glob function to use glob matching.");
    var isMatch = this.globCache[patterns.join("\0")];
    if (!isMatch) {
      isMatch = globFn(patterns, ...options);
      this.globCache[patterns.join("\0")] = isMatch;
    }
    this.options.filters.push((path) => isMatch(path));
    return this;
  }
};

// ../../node_modules/.pnpm/tinyglobby@0.2.16/node_modules/tinyglobby/dist/index.mjs
var import_picomatch = __toESM(require_picomatch2(), 1);
var isReadonlyArray = Array.isArray;
var BACKSLASHES = /\\/g;
var isWin = process.platform === "win32";
var ONLY_PARENT_DIRECTORIES = /^(\/?\.\.)+$/;
function getPartialMatcher(patterns, options = {}) {
  const patternsCount = patterns.length;
  const patternsParts = Array(patternsCount);
  const matchers = Array(patternsCount);
  let i, j;
  for (i = 0; i < patternsCount; i++) {
    const parts = splitPattern(patterns[i]);
    patternsParts[i] = parts;
    const partsCount = parts.length;
    const partMatchers = Array(partsCount);
    for (j = 0; j < partsCount; j++) partMatchers[j] = (0, import_picomatch.default)(parts[j], options);
    matchers[i] = partMatchers;
  }
  return (input) => {
    const inputParts = input.split("/");
    if (inputParts[0] === ".." && ONLY_PARENT_DIRECTORIES.test(input)) return true;
    for (i = 0; i < patternsCount; i++) {
      const patternParts = patternsParts[i];
      const matcher = matchers[i];
      const inputPatternCount = inputParts.length;
      const minParts = Math.min(inputPatternCount, patternParts.length);
      j = 0;
      while (j < minParts) {
        const part = patternParts[j];
        if (part.includes("/")) return true;
        if (!matcher[j](inputParts[j])) break;
        if (!options.noglobstar && part === "**") return true;
        j++;
      }
      if (j === inputPatternCount) return true;
    }
    return false;
  };
}
var WIN32_ROOT_DIR = /^[A-Z]:\/$/i;
var isRoot = isWin ? (p) => WIN32_ROOT_DIR.test(p) : (p) => p === "/";
function buildFormat(cwd, root, absolute) {
  if (cwd === root || root.startsWith(`${cwd}/`)) {
    if (absolute) {
      const start = cwd.length + +!isRoot(cwd);
      return (p, isDir) => p.slice(start, isDir ? -1 : void 0) || ".";
    }
    const prefix = root.slice(cwd.length + 1);
    if (prefix) return (p, isDir) => {
      if (p === ".") return prefix;
      const result = `${prefix}/${p}`;
      return isDir ? result.slice(0, -1) : result;
    };
    return (p, isDir) => isDir && p !== "." ? p.slice(0, -1) : p;
  }
  if (absolute) return (p) => posix.relative(cwd, p) || ".";
  return (p) => posix.relative(cwd, `${root}/${p}`) || ".";
}
function buildRelative(cwd, root) {
  if (root.startsWith(`${cwd}/`)) {
    const prefix = root.slice(cwd.length + 1);
    return (p) => `${prefix}/${p}`;
  }
  return (p) => {
    const result = posix.relative(cwd, `${root}/${p}`);
    return p[p.length - 1] === "/" && result !== "" ? `${result}/` : result || ".";
  };
}
var splitPatternOptions = { parts: true };
function splitPattern(path) {
  var _result$parts;
  const result = import_picomatch.default.scan(path, splitPatternOptions);
  return ((_result$parts = result.parts) === null || _result$parts === void 0 ? void 0 : _result$parts.length) ? result.parts : [path];
}
var POSIX_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\()|\\(?![()[\]{}!*+?@|]))/g;
var WIN32_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}]|^!|[!+@](?=\())/g;
var escapePosixPath = (path) => path.replace(POSIX_UNESCAPED_GLOB_SYMBOLS, "\\$&");
var escapeWin32Path = (path) => path.replace(WIN32_UNESCAPED_GLOB_SYMBOLS, "\\$&");
var escapePath = isWin ? escapeWin32Path : escapePosixPath;
function isDynamicPattern(pattern, options) {
  if ((options === null || options === void 0 ? void 0 : options.caseSensitiveMatch) === false) return true;
  const scan = import_picomatch.default.scan(pattern);
  return scan.isGlob || scan.negated;
}
function log(...tasks) {
  console.log(`[tinyglobby ${(/* @__PURE__ */ new Date()).toLocaleTimeString("es")}]`, ...tasks);
}
function ensureStringArray(value) {
  return typeof value === "string" ? [value] : value !== null && value !== void 0 ? value : [];
}
var PARENT_DIRECTORY = /^(\/?\.\.)+/;
var ESCAPING_BACKSLASHES = /\\(?=[()[\]{}!*+?@|])/g;
function normalizePattern(pattern, opts, props, isIgnore) {
  var _PARENT_DIRECTORY$exe;
  const cwd = opts.cwd;
  let result = pattern;
  if (pattern[pattern.length - 1] === "/") result = pattern.slice(0, -1);
  if (result[result.length - 1] !== "*" && opts.expandDirectories) result += "/**";
  const escapedCwd = escapePath(cwd);
  result = isAbsolute2(result.replace(ESCAPING_BACKSLASHES, "")) ? posix.relative(escapedCwd, result) : posix.normalize(result);
  const parentDir = (_PARENT_DIRECTORY$exe = PARENT_DIRECTORY.exec(result)) === null || _PARENT_DIRECTORY$exe === void 0 ? void 0 : _PARENT_DIRECTORY$exe[0];
  const parts = splitPattern(result);
  if (parentDir) {
    const n = (parentDir.length + 1) / 3;
    let i = 0;
    const cwdParts = escapedCwd.split("/");
    while (i < n && parts[i + n] === cwdParts[cwdParts.length + i - n]) {
      result = result.slice(0, (n - i - 1) * 3) + result.slice((n - i) * 3 + parts[i + n].length + 1) || ".";
      i++;
    }
    const potentialRoot = posix.join(cwd, parentDir.slice(i * 3));
    if (potentialRoot[0] !== "." && props.root.length > potentialRoot.length) {
      props.root = potentialRoot;
      props.depthOffset = -n + i;
    }
  }
  if (!isIgnore && props.depthOffset >= 0) {
    var _props$commonPath;
    (_props$commonPath = props.commonPath) !== null && _props$commonPath !== void 0 || (props.commonPath = parts);
    const newCommonPath = [];
    const length = Math.min(props.commonPath.length, parts.length);
    for (let i = 0; i < length; i++) {
      const part = parts[i];
      if (part === "**" && !parts[i + 1]) {
        newCommonPath.pop();
        break;
      }
      if (i === parts.length - 1 || part !== props.commonPath[i] || isDynamicPattern(part)) break;
      newCommonPath.push(part);
    }
    props.depthOffset = newCommonPath.length;
    props.commonPath = newCommonPath;
    props.root = newCommonPath.length > 0 ? posix.join(cwd, ...newCommonPath) : cwd;
  }
  return result;
}
function processPatterns(options, patterns, props) {
  const matchPatterns = [];
  const ignorePatterns = [];
  for (const pattern of options.ignore) {
    if (!pattern) continue;
    if (pattern[0] !== "!" || pattern[1] === "(") ignorePatterns.push(normalizePattern(pattern, options, props, true));
  }
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pattern[0] !== "!" || pattern[1] === "(") matchPatterns.push(normalizePattern(pattern, options, props, false));
    else if (pattern[1] !== "!" || pattern[2] === "(") ignorePatterns.push(normalizePattern(pattern.slice(1), options, props, true));
  }
  return {
    match: matchPatterns,
    ignore: ignorePatterns
  };
}
function buildCrawler(options, patterns) {
  const cwd = options.cwd;
  const props = {
    root: cwd,
    depthOffset: 0
  };
  const processed = processPatterns(options, patterns, props);
  if (options.debug) log("internal processing patterns:", processed);
  const { absolute, caseSensitiveMatch, debug, dot, followSymbolicLinks, onlyDirectories } = options;
  const root = props.root.replace(BACKSLASHES, "");
  const matchOptions = {
    dot,
    nobrace: options.braceExpansion === false,
    nocase: !caseSensitiveMatch,
    noextglob: options.extglob === false,
    noglobstar: options.globstar === false,
    posix: true
  };
  const matcher = (0, import_picomatch.default)(processed.match, matchOptions);
  const ignore = (0, import_picomatch.default)(processed.ignore, matchOptions);
  const partialMatcher = getPartialMatcher(processed.match, matchOptions);
  const format = buildFormat(cwd, root, absolute);
  const excludeFormatter = absolute ? format : buildFormat(cwd, root, true);
  const excludePredicate = (_, p) => {
    const relativePath = excludeFormatter(p, true);
    return relativePath !== "." && !partialMatcher(relativePath) || ignore(relativePath);
  };
  let maxDepth;
  if (options.deep !== void 0) maxDepth = Math.round(options.deep - props.depthOffset);
  const crawler = new Builder({
    filters: [debug ? (p, isDirectory) => {
      const path = format(p, isDirectory);
      const matches = matcher(path) && !ignore(path);
      if (matches) log(`matched ${path}`);
      return matches;
    } : (p, isDirectory) => {
      const path = format(p, isDirectory);
      return matcher(path) && !ignore(path);
    }],
    exclude: debug ? (_, p) => {
      const skipped = excludePredicate(_, p);
      log(`${skipped ? "skipped" : "crawling"} ${p}`);
      return skipped;
    } : excludePredicate,
    fs: options.fs,
    pathSeparator: "/",
    relativePaths: !absolute,
    resolvePaths: absolute,
    includeBasePath: absolute,
    resolveSymlinks: followSymbolicLinks,
    excludeSymlinks: !followSymbolicLinks,
    excludeFiles: onlyDirectories,
    includeDirs: onlyDirectories || !options.onlyFiles,
    maxDepth,
    signal: options.signal
  }).crawl(root);
  if (options.debug) log("internal properties:", {
    ...props,
    root
  });
  return [crawler, cwd !== root && !absolute && buildRelative(cwd, root)];
}
function formatPaths(paths, mapper) {
  if (mapper) for (let i = paths.length - 1; i >= 0; i--) paths[i] = mapper(paths[i]);
  return paths;
}
var defaultOptions = {
  caseSensitiveMatch: true,
  cwd: process.cwd(),
  debug: !!process.env.TINYGLOBBY_DEBUG,
  expandDirectories: true,
  followSymbolicLinks: true,
  onlyFiles: true
};
function getOptions(options) {
  const opts = {
    ...defaultOptions,
    ...options
  };
  opts.cwd = (opts.cwd instanceof URL ? fileURLToPath2(opts.cwd) : resolve5(opts.cwd)).replace(BACKSLASHES, "/");
  opts.ignore = ensureStringArray(opts.ignore);
  opts.fs && (opts.fs = {
    readdir: opts.fs.readdir || readdir,
    readdirSync: opts.fs.readdirSync || readdirSync,
    realpath: opts.fs.realpath || realpath,
    realpathSync: opts.fs.realpathSync || realpathSync,
    stat: opts.fs.stat || stat,
    statSync: opts.fs.statSync || statSync
  });
  if (opts.debug) log("globbing with options:", opts);
  return opts;
}
function getCrawler(globInput, inputOptions = {}) {
  var _ref;
  if (globInput && (inputOptions === null || inputOptions === void 0 ? void 0 : inputOptions.patterns)) throw new Error("Cannot pass patterns as both an argument and an option");
  const isModern = isReadonlyArray(globInput) || typeof globInput === "string";
  const patterns = ensureStringArray((_ref = isModern ? globInput : globInput.patterns) !== null && _ref !== void 0 ? _ref : "**/*");
  const options = getOptions(isModern ? inputOptions : globInput);
  return patterns.length > 0 ? buildCrawler(options, patterns) : [];
}
async function glob(globInput, options) {
  const [crawler, relative2] = getCrawler(globInput, options);
  return crawler ? formatPaths(await crawler.withPromise(), relative2) : [];
}

// lib/quality-collect.ts
function isEvaluationValue(value) {
  return value !== null && typeof value === "object" && value._tag === "CruxEvaluation" && typeof value.run === "function";
}
function isThenable(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function";
}
function fillManifest(manifest, fields) {
  return { ...manifest, ...fields };
}
async function collectEvaluationFiles(options) {
  const evaluations = [];
  const errors = [];
  const files = await glob(options.include, {
    cwd: options.rootDir,
    ignore: ["**/node_modules/**", "**/dist/**", ...normalizePatterns(options.exclude)],
    absolute: false
  });
  for (const file of files.sort()) {
    const posixFile = file.replaceAll("\\", "/");
    let moduleExports;
    try {
      moduleExports = await import(pathToFileURL3(resolve6(options.rootDir, file)).href);
    } catch (error) {
      errors.push({ message: `Failed to import ${posixFile}: ${describeError(error)}`, file: posixFile });
      continue;
    }
    for (const [exportName, value] of Object.entries(moduleExports)) {
      if (isThenable(value)) {
        errors.push({
          message: `${posixFile} export '${exportName}' is a Promise \u2014 evaluations must be defined synchronously at module top level (async-at-collect). Define the evaluation with evaluate() and load slow resources via dataset() or setup().`,
          file: posixFile
        });
        continue;
      }
      if (isEvaluationValue(value)) {
        const explicit = typeof value.id === "string" && value.id.length > 0 ? value.id : void 0;
        const explicitId = explicit !== void 0;
        const id = explicit ?? deriveEvaluationId(posixFile, exportName);
        evaluations.push({
          id,
          explicitId,
          file: posixFile,
          exportName,
          source: "file",
          evaluation: value,
          manifest: fillManifest(value.manifest, { id, explicitId, file: posixFile, exportName })
        });
      }
    }
  }
  return { evaluations, errors };
}
function normalizePatterns(patterns) {
  if (patterns === void 0) return [];
  return typeof patterns === "string" ? [patterns] : [...patterns];
}
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function collectPromptTests(prompts, core) {
  const evaluations = [];
  const errors = [];
  for (const candidate of prompts) {
    if (!core.hasPromptTests(candidate)) continue;
    let evaluation;
    try {
      evaluation = core.lowerPromptTests(candidate);
    } catch (error) {
      errors.push({ message: describeError(error) });
      continue;
    }
    const id = evaluation.id ?? `prompt:${String(candidate.id)}`;
    evaluations.push({
      id,
      explicitId: true,
      file: "",
      exportName: "",
      source: "prompt-tests",
      evaluation,
      manifest: fillManifest(evaluation.manifest, { id, explicitId: true, file: "", exportName: "" })
    });
  }
  return { evaluations, errors };
}
function findDuplicateIdErrors(evaluations) {
  const byId = /* @__PURE__ */ new Map();
  for (const entry of evaluations) {
    const bucket = byId.get(entry.id);
    if (bucket) bucket.push(entry);
    else byId.set(entry.id, [entry]);
  }
  const errors = [];
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    const locations = entries.map((entry) => entry.file === "" ? `prompt:${id}` : `${entry.file}#${entry.exportName}`);
    errors.push({
      message: `Duplicate evaluation id '${id}' defined in: ${locations.join(", ")}. Ids must be unique across the project.`,
      file: entries[0].file
    });
  }
  return errors;
}
function deriveEvaluationId(relFile, exportName) {
  const posix2 = relFile.replaceAll("\\", "/");
  const withoutExt = posix2.replace(/\.eval\.[cm]?[jt]sx?$/, "").replace(/\.[cm]?[jt]sx?$/, "");
  const base = withoutExt.replaceAll("/", ".");
  return exportName === "default" ? base : `${base}#${exportName}`;
}

// lib/quality-execute.ts
import { join as join3 } from "node:path";
var MODEL_BACKED_KINDS = /* @__PURE__ */ new Set(["prompt", "agent"]);
async function executeEvaluations(options) {
  const { core, collected, emit: emit2 } = options;
  const selection = selectEvaluations(collected, options.ids);
  if (selection.unknownId !== void 0) {
    emit2({
      type: "error",
      scope: "execute",
      message: unknownIdMessage(selection.unknownId, collected)
    });
    emit2({ type: "run:done", experiments: [], exitCode: 2 });
    return { exitCode: 2, experimentIds: [] };
  }
  const onlySelected = selection.selected.filter((entry) => entry.manifest.flags.only);
  const narrowedByOnly = onlySelected.length > 0 && onlySelected.length < selection.selected.length;
  const toRun = narrowedByOnly ? onlySelected : selection.selected;
  const forceFiltered = narrowedByOnly || (options.cases?.length ?? 0) > 0;
  let setup;
  let setupResolved = false;
  const needsSetup = toRun.some((entry) => MODEL_BACKED_KINDS.has(entry.manifest.task.kind));
  const experimentIds = [];
  let exitCode = 0;
  for (const entry of toRun) {
    if (needsSetup && !setupResolved && options.engine.resolveSetup) {
      setup = await options.engine.resolveSetup();
      setupResolved = true;
    }
    const evaluationId = entry.id;
    const definition = core.getEvaluationDefinition(entry.evaluation);
    const cellCount = countPlannedCells(entry.manifest, options.trials);
    emit2({ type: "eval:start", evaluationId, cells: cellCount });
    const engineOptions = {
      evaluationId,
      ...options.engine.qualityId !== void 0 ? { qualityId: options.engine.qualityId } : {},
      ...options.engine.dir !== void 0 ? { dir: options.engine.dir } : {},
      ...options.engine.persist !== void 0 ? { persist: options.engine.persist } : {},
      ...options.engine.redact !== void 0 ? { redact: options.engine.redact } : {},
      ...options.engine.rootDir !== void 0 ? { rootDir: options.engine.rootDir } : {},
      ...options.engine.defaults !== void 0 ? { defaults: options.engine.defaults } : {},
      ...options.engine.cacheDir !== void 0 ? { cacheDir: options.engine.cacheDir } : {},
      ...options.engine.sourceFrameResolver !== void 0 ? { sourceFrameResolver: options.engine.sourceFrameResolver } : {},
      ...options.experimentLabel !== void 0 ? { experimentLabel: options.experimentLabel } : {},
      ...setup !== void 0 ? { setup } : {},
      ...forceFiltered ? { forceFilteredRun: true } : {},
      events: {
        onCellStart: (cell) => emit2({ type: "cell:start", evaluationId, ...cell }),
        onCellDone: (cell) => emit2({ type: "cell:done", evaluationId, cell })
      }
    };
    let experiment;
    try {
      experiment = await core.runEvaluation(definition, buildOverrides(options), engineOptions);
    } catch (error) {
      if (error instanceof core.QualityDefinitionError) {
        emit2({ type: "error", scope: "execute", message: `${evaluationId}: ${error.message}` });
        exitCode = 2;
        continue;
      }
      if (error instanceof core.NotImplementedError) {
        emit2({ type: "error", scope: "execute", message: `${evaluationId}: ${error.message}` });
        exitCode = 2;
        continue;
      }
      emit2({ type: "error", scope: "execute", message: `${evaluationId}: ${describeError2(error)}` });
      exitCode = exitCode === 2 ? 2 : 1;
      continue;
    }
    experimentIds.push(experiment.experimentId);
    const persisted = options.engine.persist !== false;
    const dir = options.engine.dir ?? join3(options.engine.rootDir ?? process.cwd(), ".crux/quality");
    emit2({
      type: "eval:done",
      evaluationId,
      experimentId: experiment.experimentId,
      configFingerprint: experiment.configFingerprint,
      aggregates: experiment.aggregates,
      gates: experiment.gates,
      filteredRun: experiment.filteredRun,
      ...experiment.replay.mode !== "live" ? { replay: experiment.replay } : {},
      ...experiment.comparison !== void 0 ? { comparison: experiment.comparison } : {},
      ...experiment.baselineRef !== void 0 ? { baselineRef: experiment.baselineRef } : {},
      ...persisted ? { recordPath: core.experimentRecordPath(dir, experiment.experimentId) } : {}
    });
    if (!experiment.passed && exitCode === 0) exitCode = 1;
  }
  emit2({ type: "run:done", experiments: experimentIds, exitCode });
  return { exitCode, experimentIds };
}
function buildOverrides(options) {
  const overrides = {
    ...options.cases !== void 0 && options.cases.length > 0 ? { cases: options.cases } : {},
    ...options.variants !== void 0 && options.variants.length > 0 ? { variants: options.variants } : {},
    ...options.replayMode !== void 0 ? { replayMode: options.replayMode } : {},
    ...options.reuseOutputs === true ? { reuseOutputs: true } : {},
    ...options.trials !== void 0 ? { trials: options.trials } : {},
    ...options.concurrency !== void 0 ? { concurrency: options.concurrency } : {}
  };
  return Object.keys(overrides).length > 0 ? overrides : void 0;
}
function selectEvaluations(collected, ids) {
  if (ids === void 0 || ids.length === 0) return { selected: [...collected] };
  const byId = new Map(collected.map((entry) => [entry.id, entry]));
  const selected = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry === void 0) return { selected: [], unknownId: id };
    selected.push(entry);
  }
  return { selected };
}
function unknownIdMessage(unknownId, collected) {
  const nearest = nearestMatch(
    unknownId,
    collected.map((entry) => entry.id)
  );
  const hint = nearest === void 0 ? "" : ` Did you mean '${nearest}'?`;
  return `Unknown evaluation id '${unknownId}'.${hint}`;
}
function nearestMatch(needle, candidates) {
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(3, Math.floor(needle.length / 3)) ? best : void 0;
}
function levenshtein(a, b) {
  const previous = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(previous[j], previous[j - 1]) + 1;
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      diagonal = previous[j];
      previous[j] = Math.min(insertOrDelete, substitute);
    }
  }
  return previous[b.length];
}
function countPlannedCells(manifest, trialsOverride) {
  let cells = 0;
  for (const caseEntry of manifest.cases) {
    cells += trialsOverride ?? caseEntry.trials;
  }
  for (const datasetEntry of manifest.datasets) {
    cells += (datasetEntry.caseCount ?? 0) * (trialsOverride ?? manifest.trials);
  }
  return cells;
}
function describeError2(error) {
  return error instanceof Error ? error.message : String(error);
}

// lib/quality-observability.ts
function enableQualityRunnerObservability(core, serverUrl) {
  if (serverUrl === void 0 || serverUrl.trim() === "") return void 0;
  if (core.currentObservabilityTransport() !== void 0) return void 0;
  const transport = core.createHttpObservabilityTransport({ serverUrl });
  return core.setObservabilityTransport(transport);
}
async function flushQualityRunnerObservability(core, timeoutMs = 2e3) {
  await core.observe.flush({ timeoutMs });
}

// lib/quality-promote.ts
import { readFile as readFile2 } from "node:fs/promises";
async function promoteExperiment(options) {
  const { core, dir, emit: emit2 } = options;
  const fail = (message) => {
    emit2({ type: "error", scope: "promote", message });
    return { exitCode: 2 };
  };
  const recordPath = core.experimentRecordPath(dir, options.experimentId);
  let record;
  try {
    record = JSON.parse(await readFile2(recordPath, "utf8"));
  } catch {
    return fail(`experiment '${options.experimentId}' not found under ${dir} \u2014 run \`crux quality run\` first.`);
  }
  if (record.filteredRun) {
    return fail(
      "filtered runs cannot be promoted \u2014 paired baseline statistics need the full case population (spec 03 \xA74)."
    );
  }
  const evaluation = options.collected.find((entry) => entry.id === record.evaluationId);
  if (evaluation === void 0) {
    return fail(
      `evaluation '${record.evaluationId}' is no longer discovered \u2014 promotion needs the evaluation present in the project.`
    );
  }
  let baselineEvaluationId = record.evaluationId;
  let pinHint;
  if (!evaluation.explicitId) {
    if (options.pinId === void 0) {
      return fail(
        `evaluation '${record.evaluationId}' has a path-derived id \u2014 baselines need a stable identity. Re-run with --pin-id <id>, then pin it in source: evaluate('<id>', { \u2026 }) in ${evaluation.file}.`
      );
    }
    baselineEvaluationId = options.pinId;
    pinHint = `evaluate('${options.pinId}', { \u2026 }) \u2014 add the id in ${evaluation.file}`;
  } else if (options.pinId !== void 0 && options.pinId !== record.evaluationId) {
    return fail(
      `--pin-id '${options.pinId}' conflicts with the explicit id '${record.evaluationId}' already in source.`
    );
  }
  const variantNames = record.variants.map((variant) => variant.name);
  const variantsDeclared = !(variantNames.length === 1 && variantNames[0] === "default");
  let variantName = options.variant;
  if (variantName === void 0) {
    if (variantNames.length === 1) variantName = variantNames[0];
    else if (evaluation.manifest.baseline !== void 0) variantName = evaluation.manifest.baseline;
    else {
      return fail(
        `experiment '${options.experimentId}' ran ${variantNames.length} variants \u2014 pass --variant <name> (one of: ${variantNames.join(", ")}).`
      );
    }
  } else if (!variantNames.includes(variantName)) {
    return fail(`unknown variant '${variantName}' \u2014 this experiment ran: ${variantNames.join(", ")}.`);
  }
  const promotedBy = core.gitUserName(options.rootDir);
  const baselineRecord = {
    schemaVersion: 1,
    baselineId: core.ulid(),
    evaluationId: baselineEvaluationId,
    experimentId: options.experimentId,
    ...variantsDeclared ? { variantName } : {},
    promotedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...promotedBy !== void 0 ? { promotedBy } : {},
    configFingerprint: record.configFingerprint,
    reference: core.buildBaselineReference(record.cases, variantName)
  };
  const path = await core.writeBaselineRecord(dir, baselineRecord);
  emit2({
    type: "promote:done",
    evaluationId: baselineEvaluationId,
    experimentId: options.experimentId,
    baselineId: baselineRecord.baselineId,
    path,
    ...variantsDeclared ? { variantName } : {},
    ...pinHint !== void 0 ? { pinHint } : {}
  });
  return { exitCode: 0 };
}

// bin/quality-runner.ts
console.log = (...args) => console.error(...args);
function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}
`);
}
async function main() {
  const args = process.argv.slice(2);
  const configPath = getArg(args, "--config");
  const collectOnly = hasFlag(args, "--collect-only");
  const cases = getRepeatedArg(args, "--case");
  const variants = getRepeatedArg(args, "--variant");
  const replayArg = getArg(args, "--replay");
  const rescore = hasFlag(args, "--rescore");
  const trialsArg = getArg(args, "--trials");
  const experimentLabel = getArg(args, "--experiment");
  const maxConcurrency = getArg(args, "--max-concurrency");
  const persist = !hasFlag(args, "--no-persist");
  const promoteId = getArg(args, "--promote");
  const pinId = getArg(args, "--pin-id");
  const ids = positionalArgs(args);
  const REPLAY_MODES = ["live", "record-new", "replay-strict", "refresh"];
  if (replayArg !== void 0 && !REPLAY_MODES.includes(replayArg)) {
    emit({
      type: "error",
      scope: "execute",
      message: `Unknown --replay mode '${replayArg}'. Use: ${REPLAY_MODES.join(" \xB7 ")}.`
    });
    emit({ type: "run:done", experiments: [], exitCode: 2 });
    return 2;
  }
  const replayMode = replayArg;
  loadEnv();
  let project;
  let core;
  let restoreObservability;
  try {
    project = await loadQualityProject(configPath);
    core = await loadRunnerCore(project.configDir);
    restoreObservability = enableQualityRunnerObservability(core, process.env.CRUX_DEVTOOLS_URL);
  } catch (error) {
    emit({ type: "error", scope: "collect", message: describeError3(error) });
    emit({ type: "run:done", experiments: [], exitCode: 2 });
    return 2;
  }
  const settings = resolveQualityRunnerSettings(project.quality, project.configDir);
  const fromFiles = await collectEvaluationFiles({
    rootDir: project.configDir,
    include: settings.include,
    exclude: settings.exclude
  });
  const fromPrompts = collectPromptTests(project.prompts, core);
  const collected = [...fromFiles.evaluations, ...fromPrompts.evaluations];
  const errors = [...fromFiles.errors, ...fromPrompts.errors, ...findDuplicateIdErrors(collected)];
  emit({ type: "collect:done", evaluations: collected.map((entry) => entry.manifest), errors });
  if (errors.length > 0) {
    for (const error of errors) {
      emit({ type: "error", scope: "collect", message: error.message, ...error.file ? { file: error.file } : {} });
    }
    emit({ type: "run:done", experiments: [], exitCode: 2 });
    return 2;
  }
  if (collectOnly) {
    emit({ type: "run:done", experiments: [], exitCode: 0 });
    return 0;
  }
  if (promoteId !== void 0) {
    const result = await promoteExperiment({
      core,
      collected,
      dir: settings.dir,
      rootDir: project.configDir,
      experimentId: promoteId,
      // `--variant` is shared with run; promote takes at most one.
      ...variants.length > 0 ? { variant: variants[0] } : {},
      ...pinId !== void 0 ? { pinId } : {},
      emit
    });
    emit({ type: "run:done", experiments: [], exitCode: result.exitCode });
    return result.exitCode;
  }
  if (persist) await ensureQualityGitignore(settings.dir);
  const sourceResolver = new SourceResolver();
  try {
    const result = await executeEvaluations({
      core,
      collected,
      ...ids.length > 0 ? { ids } : {},
      ...cases.length > 0 ? { cases } : {},
      ...variants.length > 0 ? { variants } : {},
      ...replayMode !== void 0 ? { replayMode } : {},
      ...rescore ? { reuseOutputs: true } : {},
      ...trialsArg !== void 0 ? { trials: Number(trialsArg) } : {},
      ...experimentLabel !== void 0 ? { experimentLabel } : {},
      ...maxConcurrency !== void 0 ? { concurrency: Number(maxConcurrency) } : {},
      engine: {
        ...settings.qualityId !== void 0 ? { qualityId: settings.qualityId } : {},
        dir: settings.dir,
        persist,
        redact: settings.redact,
        rootDir: project.configDir,
        defaults: settings.defaults,
        cacheDir: join4(settings.dir, "cache"),
        sourceFrameResolver: {
          resolveSourceFrame: (request) => sourceResolver.resolveSourceFrame(request.file, request.line, request.column, {
            sourceRef: request.sourceRef,
            frameRadius: request.frameRadius,
            role: request.role,
            capturedAt: request.capturedAt
          })
        },
        resolveSetup: async () => {
          if (settings.setup === void 0) return void 0;
          return await settings.setup();
        }
      },
      emit
    });
    return result.exitCode;
  } finally {
    await flushQualityRunnerObservability(core);
    restoreObservability?.();
  }
}
var VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--config",
  "--case",
  "--variant",
  "--replay",
  "--trials",
  "--experiment",
  "--max-concurrency",
  "--promote",
  "--pin-id"
]);
function positionalArgs(args) {
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positionals.push(arg);
  }
  return positionals;
}
function getArg(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return void 0;
  return args[idx + 1];
}
function getRepeatedArg(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && index + 1 < args.length) {
      values.push(args[index + 1]);
      index++;
    }
  }
  return values;
}
function hasFlag(args, name) {
  return args.includes(name);
}
function describeError3(error) {
  return error instanceof Error ? error.message : String(error);
}
main().then((exitCode) => process.exit(exitCode)).catch((error) => {
  emit({ type: "error", scope: "execute", message: describeError3(error) });
  process.exit(2);
});
