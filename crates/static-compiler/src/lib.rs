//! Static Project Index compiler implementation.
//!
//! This crate owns the Rust compiler stages that turn static syntax evidence
//! and first-party primitive facts into Project Index-compatible patch events.
//! JSON-lines transport code calls the [`pipeline`] facade instead of reaching
//! into compiler internals.

pub(crate) use crux_indexer_lints as lints;
pub(crate) use crux_indexer_primitives as primitives;
pub(crate) use crux_indexer_protocol as protocol;

pub(crate) mod analysis {
    pub(crate) mod parse;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod model;
        pub(crate) mod source_refs;
        pub(crate) mod tree;

        pub(crate) use self::model::request_with_root_file_and_call_names;
    }
}

pub(crate) mod contracts {
    pub(crate) mod input;
    pub(crate) mod schema;
    #[cfg(test)]
    pub(crate) mod tests;
}

pub mod compat;

pub(crate) mod core {
    pub(crate) mod definition_merge;
    pub(crate) mod evidence;
    pub(crate) use crux_indexer_facts as facts;
    pub(crate) mod scoped_definitions;
}

pub(crate) mod finalizer {
    pub(crate) mod events;
    pub(crate) mod lint_model;
    pub(crate) mod run;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod events;
        pub(crate) mod lint;
        pub(crate) mod model;
    }
}

pub mod pipeline;
#[cfg(test)]
#[path = "protocol/tests.rs"]
mod protocol_tests;
pub(crate) mod read {
    pub(crate) mod helpers;
    pub(crate) mod injection;
    pub(crate) mod model;
    pub(crate) mod routing;
}

pub(crate) mod relation {
    pub(crate) mod fallback;
    pub(crate) mod gaps;
    pub(crate) mod model;
    pub(crate) mod policy;
    pub(crate) mod report;
    #[cfg(test)]
    pub(crate) mod tests {
        pub(crate) mod alias;
        pub(crate) mod fallback;
        pub(crate) mod gaps;
        pub(crate) mod model;
        pub(crate) mod policy;
        pub(crate) mod refs;

        pub(crate) use self::model::{definition, relation_ref};
    }
}

pub(crate) mod source {
    pub(crate) mod groups;
    pub(crate) mod model;
    #[cfg(test)]
    pub(crate) mod tests;
    pub(crate) mod tree_paths;
}
pub(crate) mod telemetry;

#[cfg(test)]
mod architecture_tests;
#[cfg(test)]
mod contract_manifest_tests;
#[cfg(test)]
mod shared_fixtures_tests;
