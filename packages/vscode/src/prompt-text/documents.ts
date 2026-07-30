/** True for file-backed source languages supported by transient PromptText. */
export function isPromptTextSourceDocument(document: {
  readonly uri: { readonly scheme: string }
  readonly languageId: string
}): boolean {
  return (
    document.uri.scheme === 'file' &&
    (document.languageId === 'typescript' ||
      document.languageId === 'typescriptreact' ||
      document.languageId === 'javascript' ||
      document.languageId === 'javascriptreact')
  )
}
