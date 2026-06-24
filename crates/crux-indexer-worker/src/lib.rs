pub(crate) mod protocol {
    pub(crate) mod static_compile;
    pub(crate) mod static_compiler;
    pub(crate) mod syntax_record;
    pub(crate) mod syntax_worker;

    pub(crate) use syntax_record::*;
}

pub(crate) mod syntax {
    pub(crate) mod argument_values;
    pub(crate) mod extract;
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

pub(crate) mod primitives {
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
    pub(crate) mod context {
        pub(crate) mod facts;
    }
    pub(crate) mod data {
        pub(crate) mod access;
        pub(crate) mod output;
    }
    pub(crate) mod definition;
    pub(crate) mod eval {
        pub(crate) mod assertions;
        pub(crate) mod facts;
    }
    pub(crate) mod facts;
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
        pub(crate) mod model;
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
    pub(crate) mod tool {
        pub(crate) mod facts;
    }
    pub(crate) mod workspace {
        pub(crate) mod facts;
    }
}

pub(crate) mod static_compiler;

pub(crate) mod worker {
    pub(crate) mod analyze_stream;
    pub(crate) mod compile_stream;
    pub(crate) mod finalize_stream;
    pub(crate) mod io;
    pub(crate) mod parse;
    pub(crate) mod static_compiler;
    #[cfg(test)]
    pub(crate) mod static_compiler_tests;
    #[cfg(test)]
    pub(crate) mod stream_tests;
    pub(crate) mod syntax;
    pub(crate) mod telemetry;
}

mod serve;

pub use serve::run_from_args;

#[cfg(test)]
pub(crate) use serve::{parse_serve_request, write_serve_response};
