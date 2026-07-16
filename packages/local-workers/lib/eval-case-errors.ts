/** Definition/configuration failure raised before any Eval external work. */
export class EvalCaseFileError extends Error {
  override readonly name = 'EvalCaseFileError'

  constructor(readonly path: string, detail: string) {
    super(`Eval Case file ${path}: ${detail}`)
  }
}
