pub(crate) mod protocol {
    pub(crate) mod native_static;
    pub(crate) mod static_syntax;
    pub(crate) mod worker;

    pub(crate) use static_syntax::*;
}

pub(crate) mod syntax {
    pub(crate) mod argument_values;
    pub(crate) mod frontend;
    pub(crate) mod function_calls;
    pub(crate) mod function_values;
    pub(crate) mod imports;
    pub(crate) mod initializers;
    pub(crate) mod match_arguments;
    pub(crate) mod match_build;
    pub(crate) mod match_expressions;
    pub(crate) mod match_interests;
    pub(crate) mod match_statements;
    pub(crate) mod object_values;
    pub(crate) mod resolve;
    pub(crate) mod source;
    pub(crate) mod values;
}

pub(crate) mod extractors {
    pub(crate) mod agent {
        pub(crate) mod convex;
        pub(crate) mod facts;
        pub(crate) mod metadata;
    }
    pub(crate) mod blackboard {
        pub(crate) mod facts;
    }
    pub(crate) mod composition {
        pub(crate) mod facts;
        pub(crate) mod output;
        pub(crate) mod relations;
        pub(crate) mod values;
    }
    pub(crate) mod context;
    pub(crate) mod data {
        pub(crate) mod access;
        pub(crate) mod output;
    }
    pub(crate) mod definition;
    pub(crate) mod eval {
        pub(crate) mod assertions;
        pub(crate) mod facts;
    }
    pub(crate) mod flow {
        pub(crate) mod facts;
        pub(crate) mod output;
    }
    pub(crate) mod injection {
        pub(crate) mod injectable;
        pub(crate) mod model;
        pub(crate) mod tools;
    }
    pub(crate) mod memory {
        pub(crate) mod blocks;
        pub(crate) mod facts;
        pub(crate) mod id;
        pub(crate) mod store;
    }
    pub(crate) mod prompt {
        pub(crate) mod facts;
    }
    pub(crate) mod projection;
    pub(crate) mod rag {
        pub(crate) mod facts;
        pub(crate) mod metadata;
    }
    pub(crate) mod record_values;
    pub(crate) mod registry {
        pub(crate) mod facts;
    }
    pub(crate) mod routing {
        pub(crate) mod cascade;
        pub(crate) mod facts;
        pub(crate) mod fallback;
        pub(crate) mod output;
        pub(crate) mod router;
        pub(crate) mod source_refs;
    }
    pub(crate) mod runtime {
        pub(crate) mod flow;
        pub(crate) mod join;
        pub(crate) mod memory;
    }
    pub(crate) mod safety {
        pub(crate) mod facts;
    }
    pub(crate) mod schema;
    pub(crate) mod scorer {
        pub(crate) mod facts;
    }
    pub(crate) mod source_refs;
    pub(crate) mod static_syntax;
    pub(crate) mod tool {
        pub(crate) mod facts;
    }
    pub(crate) mod workspace {
        pub(crate) mod facts;
    }
}

pub(crate) mod index_compiler;
pub(crate) mod lints {
    pub(crate) mod builder;
    pub(crate) mod contracts;
    pub(crate) mod emit;
    pub(crate) mod filter;
    pub(crate) mod findings;
    pub(crate) mod helpers;
    pub(crate) mod injection {
        pub(crate) mod entries;
        pub(crate) mod evidence;
        pub(crate) mod evidence_data;
        pub(crate) mod inputs;
        pub(crate) mod model;
        pub(crate) mod model_helpers;
        pub(crate) mod rules;
    }
    pub(crate) mod propagation;
    pub(crate) mod rules {
        pub(crate) mod core;
        pub(crate) mod definition_tail;
        pub(crate) mod filter;
        pub(crate) mod relation;
        pub(crate) mod routing;
    }
}
mod worker;

pub use worker::run_from_args;

#[cfg(test)]
pub(crate) use worker::{parse_serve_request, write_serve_response};

#[cfg(test)]
mod architecture_tests;
#[cfg(test)]
mod shared_fixtures_tests;
