import ts from 'typescript'

export function collectTopLevelInitializers(sourceFile: ts.SourceFile, out: Map<string, ts.Expression>): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    collectVariableStatementInitializers(statement, out)
  }
}

export function scopedInitializersForNode(node: ts.Node, base: Map<string, ts.Expression>): Map<string, ts.Expression> {
  const scoped = new Map(base)
  const ancestors: ts.Node[] = []
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) ancestors.unshift(current)
    current = current.parent
  }
  const nodeStart = node.getStart()
  for (const ancestor of ancestors) {
    const statements = ts.isSourceFile(ancestor) || ts.isBlock(ancestor) ? ancestor.statements : undefined
    if (!statements) continue
    for (const statement of statements) {
      if (statement.getStart() >= nodeStart) break
      if (ts.isVariableStatement(statement)) collectVariableStatementInitializers(statement, scoped)
    }
  }
  return scoped
}

function collectVariableStatementInitializers(statement: ts.VariableStatement, out: Map<string, ts.Expression>): void {
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      out.set(declaration.name.text, declaration.initializer)
      continue
    }
    if (ts.isObjectBindingPattern(declaration.name) && declaration.initializer) {
      for (const element of declaration.name.elements) {
        if (ts.isIdentifier(element.name)) out.set(element.name.text, declaration.initializer)
      }
    }
  }
}
