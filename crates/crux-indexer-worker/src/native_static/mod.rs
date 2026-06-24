//! Native static compiler facade.
//!
//! This module is the crate-local boundary for Rust-owned native static work:
//! prepare selected files, analyze native facts, finalize patch events, and
//! compile native-only streams. Transport code calls the facade instead of
//! reaching into compiler internals.

pub(crate) mod pipeline;
pub(crate) mod telemetry;
