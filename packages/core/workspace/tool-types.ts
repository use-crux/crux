/**
 * Type-level names for generated workspace tools.
 *
 * @module
 */

import type { ToolDef } from "../types/tool";
import type { WorkspaceToolOptions } from "./types";

/** Extract the literal prefix from workspace tool options. */
export type WorkspaceToolPrefix<Options> = Options extends {
  readonly prefix?: infer Prefix;
}
  ? Extract<Prefix, string> extends never
    ? undefined
    : Extract<Prefix, string>
  : undefined;

/** Extract whether delete is explicitly enabled from workspace tool options. */
export type WorkspaceToolDelete<Options> = Options extends {
  readonly delete: true;
}
  ? true
  : false;

/** Extract whether the undo tool is explicitly enabled from workspace tool options. */
export type WorkspaceToolUndo<Options> = Options extends {
  readonly undo: true;
}
  ? true
  : false;

/** Resolve the effective prefix when per-call tool options override config defaults. */
export type WorkspaceToolPrefixWithDefaults<Defaults, Options> =
  "prefix" extends keyof Options
    ? WorkspaceToolPrefix<Options>
    : WorkspaceToolPrefix<NonNullable<Defaults>>;

/** Resolve the effective delete setting when per-call tool options override config defaults. */
export type WorkspaceToolDeleteWithDefaults<Defaults, Options> =
  "delete" extends keyof Options
    ? WorkspaceToolDelete<Options>
    : WorkspaceToolDelete<NonNullable<Defaults>>;

/** Resolve the effective undo setting when per-call tool options override config defaults. */
export type WorkspaceToolUndoWithDefaults<Defaults, Options> =
  "undo" extends keyof Options
    ? WorkspaceToolUndo<Options>
    : WorkspaceToolUndo<NonNullable<Defaults>>;

type WorkspaceToolPrefixPart<Prefix extends string | undefined> =
  Prefix extends string ? PascalCaseWords<Prefix> : "";
type PascalCaseWords<Value extends string> =
  Value extends `${infer Head}-${infer Tail}`
    ? `${Capitalize<Head>}${PascalCaseWords<Tail>}`
    : Value extends `${infer Head}_${infer Tail}`
      ? `${Capitalize<Head>}${PascalCaseWords<Tail>}`
      : Value extends `${infer Head} ${infer Tail}`
        ? `${Capitalize<Head>}${PascalCaseWords<Tail>}`
        : Capitalize<Value>;

/** Resolved generated workspace tool names for a literal prefix. */
export interface WorkspaceToolNames<
  Prefix extends string | undefined = undefined,
> {
  readonly list: `list${WorkspaceToolPrefixPart<Prefix>}Workspace`;
  readonly readFile: `read${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
  readonly writeFile: `write${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
  readonly editFile: `edit${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
  readonly renameFile: `rename${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
  readonly grep: `grep${WorkspaceToolPrefixPart<Prefix>}Workspace`;
  readonly deleteFile: `delete${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
  readonly undoFile: `undo${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`;
}

/** Generated workspace tools for a literal prefix and opt-in tool settings. */
export type WorkspaceTools<
  Prefix extends string | undefined = undefined,
  Delete extends boolean | undefined = false,
  Undo extends boolean | undefined = false,
> = {
  readonly [Key in WorkspaceToolNames<Prefix>["list"]]: ToolDef;
} & {
  readonly [Key in WorkspaceToolNames<Prefix>["readFile"]]: ToolDef;
} & {
  readonly [Key in WorkspaceToolNames<Prefix>["writeFile"]]: ToolDef;
} & {
  readonly [Key in WorkspaceToolNames<Prefix>["editFile"]]: ToolDef;
} & {
  readonly [Key in WorkspaceToolNames<Prefix>["renameFile"]]: ToolDef;
} & {
  readonly [Key in WorkspaceToolNames<Prefix>["grep"]]: ToolDef;
} & (Delete extends true
    ? {
        readonly [Key in WorkspaceToolNames<Prefix>["deleteFile"]]: ToolDef;
      }
    : {}) &
  (Undo extends true
    ? {
        readonly [Key in WorkspaceToolNames<Prefix>["undoFile"]]: ToolDef;
      }
    : {});
