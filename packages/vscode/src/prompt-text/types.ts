import type {
  DecorationRenderOptions,
  ThemeColor,
} from 'vscode'

/**
 * Presentation roles understood by the PromptText editor client.
 *
 * Roles describe visual intent rather than Markdown syntax tokens. This keeps
 * the client independent of the classifier and lets VS Code map one stable,
 * finite contract to the active color theme.
 */
export const promptTextDecorationRoles = [
  'heading',
  'link',
  'code',
  'emphasis',
  'strong',
  'list',
  'blockquote',
] as const

/** A visual role emitted for a proven PromptText literal range. */
export type PromptTextDecorationRole = typeof promptTextDecorationRoles[number]

/** Creates a VS Code theme reference without coupling pure tests to the extension host. */
export type ThemeColorFactory = (id: string) => ThemeColor

/**
 * Create the complete role-to-rendering contract for one extension instance.
 *
 * The mapping uses editor-owned theme colors and font treatments only. It
 * therefore follows theme changes without rebuilding types, avoids fixed RGB
 * values, and leaves selection, diagnostics, and cursor colors under VS Code's
 * control.
 *
 * @param themeColor - Creates a reference to a registered VS Code theme color.
 * @returns Render options for every supported PromptText decoration role.
 */
export function createPromptTextDecorationRenderOptions(
  themeColor: ThemeColorFactory,
): Readonly<Record<PromptTextDecorationRole, DecorationRenderOptions>> {
  return {
    heading: {
      color: themeColor('symbolIcon.classForeground'),
      fontWeight: 'bold',
    },
    link: {
      color: themeColor('textLink.foreground'),
      textDecoration: 'underline',
    },
    code: {
      // `textPreformat.foreground` is not legible in High Contrast Dark 1.90.
      color: themeColor('editor.foreground'),
    },
    emphasis: {
      fontStyle: 'italic',
    },
    strong: {
      fontWeight: 'bold',
    },
    list: {
      color: themeColor('symbolIcon.operatorForeground'),
      fontWeight: 'bold',
    },
    blockquote: {
      color: themeColor('descriptionForeground'),
      fontStyle: 'italic',
    },
  } satisfies Record<PromptTextDecorationRole, DecorationRenderOptions>
}
