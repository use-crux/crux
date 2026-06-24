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

pub(crate) mod static_compiler {
    pub(crate) mod analyze;
    pub(crate) mod analyze_parse;
    #[cfg(test)]
    pub(crate) mod analyze_source_ref_tests;
    #[cfg(test)]
    pub(crate) mod analyze_tests;
    #[cfg(test)]
    pub(crate) mod analyze_tree_tests;
    pub(crate) mod definition_merge;
    pub(crate) mod evidence;
    pub(crate) mod facts;
    pub(crate) mod finalize;
    pub(crate) mod finalize_events;
    #[cfg(test)]
    pub(crate) mod finalize_events_tests;
    pub(crate) mod finalize_lint_model;
    #[cfg(test)]
    pub(crate) mod finalize_lint_tests;
    #[cfg(test)]
    pub(crate) mod finalize_tests;
    pub(crate) mod input_contract_schema;
    pub(crate) mod input_contracts;
    #[cfg(test)]
    pub(crate) mod input_contracts_tests;
    pub(crate) mod lint_builder;
    pub(crate) mod lint_contracts;
    pub(crate) mod lint_core_rules;
    pub(crate) mod lint_definition_tail;
    pub(crate) mod lint_emit;
    pub(crate) mod lint_filter;
    pub(crate) mod lint_filter_rules;
    pub(crate) mod lint_helpers;
    pub(crate) mod lint_injection_entries;
    pub(crate) mod lint_injection_evidence;
    pub(crate) mod lint_injection_evidence_data;
    pub(crate) mod lint_injection_inputs;
    pub(crate) mod lint_injection_model;
    pub(crate) mod lint_injection_model_helpers;
    pub(crate) mod lint_injection_rules;
    pub(crate) mod lint_propagation;
    pub(crate) mod lint_relation_rules;
    pub(crate) mod lint_routing;
    pub(crate) mod lints;
    #[cfg(test)]
    pub(crate) mod protocol_tests;
    pub(crate) mod read_model;
    pub(crate) mod read_model_helpers;
    pub(crate) mod read_model_injection;
    pub(crate) mod read_model_routing;
    #[cfg(test)]
    pub(crate) mod relation_alias_tests;
    pub(crate) mod relation_fallback;
    #[cfg(test)]
    pub(crate) mod relation_fallback_tests;
    #[cfg(test)]
    pub(crate) mod relation_gap_tests;
    pub(crate) mod relation_gaps;
    pub(crate) mod relation_policy;
    #[cfg(test)]
    pub(crate) mod relation_policy_tests;
    #[cfg(test)]
    pub(crate) mod relation_ref_tests;
    pub(crate) mod relation_report;
    pub(crate) mod relations;
    #[cfg(test)]
    pub(crate) mod relations_tests;
    pub(crate) mod scoped_definitions;
    pub(crate) mod source_groups;
    pub(crate) mod source_model;
    #[cfg(test)]
    pub(crate) mod source_model_tests;
    pub(crate) mod tree_paths;
}

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
