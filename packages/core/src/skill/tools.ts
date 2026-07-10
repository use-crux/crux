/**
 * Internal skill loader tool names.
 *
 * Tool definitions are created by `SkillActivationSession.tools()`. These
 * constants let adapter internals identify Crux-owned loader calls without
 * exposing a separate public tool factory API.
 *
 * @module
 */

/** Marker used by executors to identify LoadSkill as a system tool. */
export const LOAD_SKILL_TOOL_NAME = '__crux_LoadSkill' as const

/** Marker used by executors to identify LoadReference as a Crux skill tool. */
export const LOAD_REFERENCE_TOOL_NAME = '__crux_LoadReference' as const
