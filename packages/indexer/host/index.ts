/**
 * Crux-owned Project Index host facades.
 *
 * Host modules are intentionally separate from the public root package and the
 * extension authoring surface. They are narrow bridges for bundled workers and
 * local runtime integrations that need compiler, semantic, runtime, or Static
 * Index compatibility-host capabilities.
 *
 * @module
 */

export * from './static-index'
export * from './semantic'
export * from './runtime'
export * from './static-compat'
