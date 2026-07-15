/** Internal identity attached to tools scripted by the Quality runner. */
export const TOOL_EXECUTION_MOCK: unique symbol = Symbol.for(
  "crux.toolExecutionMock",
);

/** Mark a scripted tool implementation without changing its public shape. */
export function withToolExecutionMock<TTool extends object>(
  tool: TTool,
): TTool {
  return Object.assign(tool, { [TOOL_EXECUTION_MOCK]: true as const });
}

/** Return whether a tool execution is supplied by an explicit mock. */
export function isToolExecutionMock(tool: unknown): boolean {
  return (
    typeof tool === "object" &&
    tool !== null &&
    (tool as { readonly [TOOL_EXECUTION_MOCK]?: unknown })[
      TOOL_EXECUTION_MOCK
    ] === true
  );
}
