export interface CapturedRoute {
  readonly path?: string
  readonly method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE'
  readonly handler: unknown
}

export class TestRouter {
  readonly routes: CapturedRoute[] = []

  route(route: CapturedRoute): void {
    this.routes.push(route)
  }

  handler(method: CapturedRoute['method']): TestHttpAction {
    const route = this.routes.find((candidate) => candidate.method === method)
    if (!route) throw new Error(`Missing ${method} test route.`)
    return route.handler as TestHttpAction
  }
}

export interface TestHttpAction {
  _handler(ctx: unknown, request: Request): Promise<Response>
}
