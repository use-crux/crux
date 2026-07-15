import { withCrux, type CruxExecutionContext } from '../src/observability/workers'

type AssertEqual<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false
type Expect<T extends true> = T

interface TestEnv {
  readonly label: string
}

const handler = withCrux(
  async (request: Request, env: TestEnv, context: CruxExecutionContext) => {
    context.waitUntil(Promise.resolve())
    return Response.json({ url: request.url, label: env.label })
  },
  {
    context: (_request, _env, context) => context,
    invocation: (_context, _request, env) => ({
      flushTimeoutMs: env.label.length,
    }),
  },
)

type _ArgumentsRemainExact = Expect<
  AssertEqual<
    Parameters<typeof handler>,
    [Request, TestEnv, CruxExecutionContext]
  >
>
type _AwaitedResultRemainsExact = Expect<
  AssertEqual<ReturnType<typeof handler>, Promise<Response>>
>
