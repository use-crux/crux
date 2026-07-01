/**
 * Flow handler parameter inspection.
 *
 * `Function.length` stops counting at the first defaulted parameter, so a
 * handler like `(flow, input = {}) => {}` reports arity 1 even though it
 * accepts flow input. This module keeps that runtime compatibility logic out
 * of the flow executor.
 *
 * @module
 */

type FlowHandlerFunction = (...args: never[]) => unknown

/** Return true when a flow handler declares an input parameter. */
export function flowHandlerAcceptsInput(handler: FlowHandlerFunction): boolean {
  const parameters = handlerParameterSource(Function.prototype.toString.call(handler))
  return parameters ? splitTopLevelParameters(parameters).length >= 2 : false
}

function handlerParameterSource(source: string): string | undefined {
  const trimmed = source.trim()
  const arrowIndex = trimmed.indexOf('=>')
  if (arrowIndex >= 0) return arrowParameterSource(trimmed.slice(0, arrowIndex))

  const openParen = trimmed.indexOf('(')
  if (openParen < 0) return undefined
  const closeParen = matchingCloseParen(trimmed, openParen)
  return closeParen > openParen ? trimmed.slice(openParen + 1, closeParen) : undefined
}

function arrowParameterSource(source: string): string | undefined {
  const candidate = source.trim().replace(/^async\s+/, '')
  if (!candidate) return undefined
  if (!candidate.startsWith('(')) return candidate

  const closeParen = matchingCloseParen(candidate, 0)
  return closeParen === candidate.length - 1 ? candidate.slice(1, closeParen) : undefined
}

function splitTopLevelParameters(source: string): string[] {
  const parameters: string[] = []
  let start = 0
  let depth = 0
  let quote: string | undefined
  let escaped = false

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }

    if (character === '(' || character === '[' || character === '{') {
      depth++
      continue
    }

    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (character === ',' && depth === 0) {
      pushParameter(parameters, source.slice(start, index))
      start = index + 1
    }
  }

  pushParameter(parameters, source.slice(start))
  return parameters
}

function pushParameter(parameters: string[], value: string): void {
  const parameter = value.trim()
  if (parameter) parameters.push(parameter)
}

function matchingCloseParen(source: string, openParen: number): number {
  let depth = 0
  let quote: string | undefined
  let escaped = false

  for (let index = openParen; index < source.length; index++) {
    const character = source[index]!

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }

    if (character === '(') {
      depth++
      continue
    }

    if (character === ')') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}
