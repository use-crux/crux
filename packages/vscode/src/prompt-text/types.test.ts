import type { ThemeColor } from 'vscode'
import { describe, expect, it } from 'vitest'
import {
  createPromptTextDecorationRenderOptions,
  promptTextDecorationRoles,
} from './types.js'

describe('createPromptTextDecorationRenderOptions', () => {
  it('exhaustively maps roles to theme-aware color and font treatments', () => {
    const options = createPromptTextDecorationRenderOptions(themeColor)

    expect(Object.keys(options)).toEqual(promptTextDecorationRoles)
    expect(options).toEqual({
      heading: {
        color: { id: 'symbolIcon.classForeground' },
        fontWeight: 'bold',
      },
      link: {
        color: { id: 'textLink.foreground' },
        textDecoration: 'underline',
      },
      code: {
        color: { id: 'editor.foreground' },
      },
      emphasis: {
        fontStyle: 'italic',
      },
      strong: {
        fontWeight: 'bold',
      },
      list: {
        color: { id: 'symbolIcon.operatorForeground' },
        fontWeight: 'bold',
      },
      blockquote: {
        color: { id: 'descriptionForeground' },
        fontStyle: 'italic',
      },
    })
  })
})

function themeColor(id: string): ThemeColor {
  return { id }
}
