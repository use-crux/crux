use std::collections::HashSet;

use crate::{
    native_static::primitives::projection::project_native_facts,
    protocol::{
        ParseRequest, StaticNativeFactProjection, StaticSourceMatch, StaticSyntaxFileRecord,
    },
    syntax::frontend::parse_source,
};

/// Parse a legacy static syntax record and attach native fact projections.
///
/// New native static compilation should call `syntax::frontend::parse_source`
/// first and run primitive projection explicitly through `native_static`.
/// This wrapper preserves the existing static syntax worker payload.
pub fn parse_static_syntax_record(input: ParseRequest) -> Result<StaticSyntaxFileRecord, String> {
    let source_text = input.source.clone();
    let prune_native_fact_call_names = input
        .prune_native_fact_call_names
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let mut record = parse_source(input)?;
    let native_facts = project_native_facts(
        &record.file,
        &source_text,
        &record.imports,
        &record.local_initializers,
        &record.matches,
    );
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
            callee,
            source,
            ..
        } if prune_call_names.contains(&callee.name) => StaticSourceMatch::Call {
            variable_name,
            local_name,
            exported,
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
