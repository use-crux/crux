use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::{
    imports::collect_import_records,
    initializers::collect_local_initializers,
    match_interests::CalleeMatcher,
    match_statements::collect_matches,
    native_facts::project_native_facts,
    protocol::{
        FRONTEND_NAME, FRONTEND_VERSION, IndexDiagnostic, ParseRequest, StaticSyntaxFileRecord,
        StaticSyntaxFrontendIdentity,
    },
    source::{SourceView, sha256},
};

pub fn parse_static_syntax_record(input: ParseRequest) -> Result<StaticSyntaxFileRecord, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(&input.file)
        .unwrap_or_default()
        .with_module(true);
    let parsed = Parser::new(&allocator, &input.source, source_type).parse();
    let view = SourceView::new(&input.file, &input.source);
    let imports = collect_import_records(&input.root, &input.file, &parsed.program.body, &view);
    let imports_by_local_name = imports
        .iter()
        .map(|item| (item.local_name.clone(), item.clone()))
        .collect::<HashMap<_, _>>();
    let call_matcher = CalleeMatcher::for_calls(input.call_names, input.call_interests);
    let constructor_matcher = CalleeMatcher::for_constructors(
        input.constructor_names,
        input.constructor_interests,
        vec!["Agent".to_string()],
    );
    let matches = collect_matches(
        &input.root,
        &input.file,
        &view,
        &parsed.program.body,
        &imports_by_local_name,
        &call_matcher,
        &constructor_matcher,
    );
    let local_initializers =
        collect_local_initializers(&view, &parsed.program.body, &imports_by_local_name);
    let native_facts = project_native_facts(&input.file, &imports, &local_initializers, &matches);
    let prune_native_fact_call_names = input
        .prune_native_fact_call_names
        .into_iter()
        .collect::<HashSet<_>>();
    let matches = prune_native_fact_matches(matches, &native_facts, &prune_native_fact_call_names);

    Ok(StaticSyntaxFileRecord {
        schema_version: 1,
        frontend: StaticSyntaxFrontendIdentity {
            name: FRONTEND_NAME.to_string(),
            version: FRONTEND_VERSION.to_string(),
        },
        file: input.file.clone(),
        source_hash: sha256(&input.source),
        imports,
        matches,
        native_facts,
        local_initializers,
        diagnostics: parsed
            .errors
            .into_iter()
            .enumerate()
            .map(|(index, error)| IndexDiagnostic {
                id: format!("syntax:{}:{index}", input.file),
                severity: "error".to_string(),
                code: "index.syntax_parse".to_string(),
                message: error.to_string(),
                source: view.location_for_offset(0),
            })
            .collect(),
    })
}

fn prune_native_fact_matches(
    matches: Vec<crate::protocol::StaticSourceMatch>,
    native_facts: &[crate::protocol::StaticNativeFactProjection],
    prune_call_names: &HashSet<String>,
) -> Vec<crate::protocol::StaticSourceMatch> {
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
    source_match: crate::protocol::StaticSourceMatch,
    prune_call_names: &HashSet<String>,
) -> crate::protocol::StaticSourceMatch {
    match source_match {
        crate::protocol::StaticSourceMatch::Call {
            variable_name,
            local_name,
            exported,
            callee,
            source,
            ..
        } if prune_call_names.contains(&callee.name) => crate::protocol::StaticSourceMatch::Call {
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
