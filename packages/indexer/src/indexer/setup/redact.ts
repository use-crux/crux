const ASSIGNMENT =
  /\b([A-Z][A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY|URL)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|\S+)/g
const URL_CREDENTIALS =
  /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@(?=[^\s/?#]+(?:[/?#]|\s|$))/gi
const SECRET_QUERY = /([?&](?:password|token|secret|api[_-]?key)=)[^&\s]+/gi

/** Remove credential-shaped values before setup text crosses a tooling boundary. */
export function redactSetupText(value: string): string {
  return value
    .replace(ASSIGNMENT, '$1=[REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(SECRET_QUERY, '$1[REDACTED]')
}
