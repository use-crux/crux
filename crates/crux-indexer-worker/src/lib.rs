pub(crate) use crux_indexer_extractors as extractors;
pub(crate) use crux_indexer_lints as lints;
pub(crate) use crux_indexer_protocol as protocol;

pub(crate) mod index_compiler;
mod worker;

pub use worker::run_from_args;

#[cfg(test)]
pub(crate) use worker::{parse_serve_request, write_serve_response};

#[cfg(test)]
mod architecture_tests;
#[cfg(test)]
mod shared_fixtures_tests;
