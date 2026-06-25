pub(crate) use crux_indexer_primitives as primitives;
pub(crate) use crux_indexer_protocol as protocol;

mod worker;

pub use worker::run_from_args;

#[cfg(test)]
pub(crate) use worker::{parse_serve_request, write_serve_response};

#[cfg(test)]
mod architecture_tests;
