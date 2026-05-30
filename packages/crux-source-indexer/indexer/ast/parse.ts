import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export async function readSourceFile(file: string): Promise<ts.SourceFile> {
  const source = await readFile(file, 'utf8')
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
}

export function createSourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
}
