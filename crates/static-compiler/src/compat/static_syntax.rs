//! Compatibility helpers for the legacy Static Syntax worker payload.
//!
//! Static Index compilation should parse syntax evidence and run primitive
//! projection as separate compiler stages. The legacy syntax worker protocol
//! still expects records with first-party native fact projections attached, so
//! this module keeps that parse-plus-project bridge at the compiler boundary.

use std::collections::HashSet;

use crate::{
    primitives::projection::project_static_syntax_record,
    protocol::{
        ParseRequest, StaticNativeFactProjection, StaticSourceMatch, StaticSyntaxFileRecord,
    },
};

/// Parse a Static Syntax record and attach first-party native fact projections.
///
/// This is a compatibility facade for callers that still need the legacy
/// Static Syntax worker response shape. New Static Index paths should keep the
/// parse and primitive projection stages explicit.
pub fn parse_static_syntax_record(input: ParseRequest) -> Result<StaticSyntaxFileRecord, String> {
    let source_text = input.source.clone();
    let prune_native_fact_call_names = input
        .prune_native_fact_call_names
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let mut record = crux_indexer_syntax_oxc::parse_source(input)?;
    let native_facts = project_static_syntax_record(&record, &source_text);
    record.matches =
        prune_native_fact_matches(record.matches, &native_facts, &prune_native_fact_call_names);
    record.native_facts = native_facts;

    Ok(record)
}

fn prune_native_fact_matches(
    matches: Vec<StaticSourceMatch>,
    native_facts: &[StaticNativeFactProjection],
    prune_call_names: &HashSet<String>,
) -> Vec<StaticSourceMatch> {
    if prune_call_names.is_empty() || native_facts.is_empty() {
        return matches;
    }
    let native_match_indexes = native_facts
        .iter()
        .map(|projection| projection.match_index)
        .collect::<HashSet<_>>();
    matches
        .into_iter()
        .enumerate()
        .map(|(index, source_match)| {
            if !native_match_indexes.contains(&index) {
                return source_match;
            }
            prune_native_fact_match(source_match, prune_call_names)
        })
        .collect()
}

fn prune_native_fact_match(
    source_match: StaticSourceMatch,
    prune_call_names: &HashSet<String>,
) -> StaticSourceMatch {
    match source_match {
        StaticSourceMatch::Call {
            variable_name,
            local_name,
            exported,
            eager_execution,
            callee,
            source,
            ..
        } if prune_call_names.contains(&callee.name) => StaticSourceMatch::Call {
            variable_name,
            local_name,
            exported,
            eager_execution,
            callee,
            args: Vec::new(),
            object_arg: None,
            source,
            snippet: None,
            local_initializers: Vec::new(),
        },
        other => other,
    }
}
