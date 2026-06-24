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
    pub(crate) mod agent_convex_facts;
    pub(crate) mod agent_facts;
    pub(crate) mod agent_metadata;
    pub(crate) mod blackboard_facts;
    pub(crate) mod composition_facts;
    pub(crate) mod composition_output;
    pub(crate) mod composition_relations;
    pub(crate) mod composition_values;
    pub(crate) mod context_facts;
    pub(crate) mod data_access;
    pub(crate) mod data_access_output;
    pub(crate) mod definition;
    pub(crate) mod eval_assertions;
    pub(crate) mod eval_facts;
    pub(crate) mod facts;
    pub(crate) mod flow_facts;
    pub(crate) mod flow_output;
    pub(crate) mod injectable_facts;
    pub(crate) mod injection;
    pub(crate) mod injection_tools;
    pub(crate) mod memory_blocks;
    pub(crate) mod memory_facts;
    pub(crate) mod memory_id;
    pub(crate) mod memory_store;
    pub(crate) mod prompt_facts;
    pub(crate) mod rag_facts;
    pub(crate) mod rag_metadata;
    pub(crate) mod record_values;
    pub(crate) mod registry_facts;
    pub(crate) mod routing_cascade;
    pub(crate) mod routing_facts;
    pub(crate) mod routing_fallback;
    pub(crate) mod routing_model;
    pub(crate) mod routing_output;
    pub(crate) mod routing_router;
    pub(crate) mod routing_source_refs;
    pub(crate) mod runtime_join;
    pub(crate) mod runtime_join_flow;
    pub(crate) mod runtime_join_memory;
    pub(crate) mod safety_facts;
    pub(crate) mod schema;
    pub(crate) mod schema_common;
    pub(crate) mod schema_convex;
    pub(crate) mod schema_zod;
    pub(crate) mod scorer_facts;
    pub(crate) mod source_refs;
    pub(crate) mod tool_facts;
    pub(crate) mod workspace_facts;
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
