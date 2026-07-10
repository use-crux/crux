/**
 * Runtime Bridge contract for devtools command execution.
 *
 * The bridge is a dev-only control plane. It lets the Go devtools backend send
 * typed Crux-owned commands to a live runtime peer. Observability ingest remains
 * a separate runtime-to-Go telemetry plane.
 *
 * @module
 */

export * from './protocol'
export * from './client'
export * from './commands'
