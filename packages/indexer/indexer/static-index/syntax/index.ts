/**
 * Static Index syntax frontend surfaces.
 *
 * Parser frontends emit Static Syntax records that the Project Index compiler
 * can project without exposing TypeScript, Oxc, or other parser-native AST
 * objects to extensions.
 *
 * @module
 */

export { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from './frontends/oxc'
