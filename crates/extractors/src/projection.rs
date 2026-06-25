//! First-party native static primitive projection.
//!
//! The syntax frontend produces backend-neutral evidence. This module owns the
//! explicit step that turns matched calls and initializers into Crux primitive
//! fact projections for native static compilation.

use std::collections::HashMap;

use rayon::prelude::*;
use serde_json::Value;

use crate::{
    agent::facts::agent_facts,
    blackboard::facts::blackboard_facts,
    composition::facts::composition_facts,
    context::facts::context_facts,
    context::{self, CallParts, PrimitiveContext},
    eval::facts::eval_facts,
    flow::facts::flow_facts,
    injection::injectable::injectable_facts,
    memory::facts::memory_facts,
    prompt::facts::prompt_facts,
    protocol::{
        StaticImportRecord, StaticInitializerRecord, StaticNativeFactProjection, StaticSourceMatch,
        StaticSyntaxFileRecord,
    },
    rag::facts::rag_facts,
    registry::facts::{registry_facts, registry_skill_facts},
    routing::facts::project_routing_native_fact,
    safety::facts::safety_facts,
    scorer::facts::scorer_facts,
    tool::facts::project_tool_native_fact,
    workspace::facts::workspace_facts,
};

type FirstPartyProjector = fn(&PrimitiveContext<'_>, &CallParts<'_>) -> Option<Value>;

const FIRST_PARTY_PROJECTORS: [(&str, FirstPartyProjector); 13] = [
    ("context", context_facts),
    ("prompt", prompt_facts),
    ("injectable", injectable_facts),
    ("agent", agent_facts),
    ("safety", safety_facts),
    ("scorer", scorer_facts),
    ("rag.retriever", rag_facts),
    ("skill-registry", registry_facts),
    ("registry-skill", registry_skill_facts),
    ("blackboard", blackboard_facts),
    ("memory", memory_facts),
    ("flow", flow_facts),
    ("composition", composition_facts),
];

/// Projects first-party static facts that the native syntax frontend can prove completely.
///
/// This gate is intentionally strict: a primitive is either covered for its full supported static
/// extractor contract or it emits no native packet and falls back to the TypeScript extension
/// runtime. Partial "simple" primitive packets are not allowed because they hide coverage gaps and
/// can suppress user extensions that inspect the same source match.
pub fn project_native_facts(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    matches: &[StaticSourceMatch],
) -> Vec<StaticNativeFactProjection> {
    project_native_facts_with_records(
        file,
        source_text,
        imports,
        local_initializers,
        matches,
        None,
    )
}

/// Project first-party facts with optional records for selected dependency files.
pub fn project_native_facts_with_records(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    matches: &[StaticSourceMatch],
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Vec<StaticNativeFactProjection> {
    let mut projections = matches
        .par_iter()
        .enumerate()
        .filter_map(|(match_index, source_match)| {
            workspace_native_fact(
                file,
                imports,
                local_initializers,
                match_index,
                source_match,
                records_by_file,
            )
            .or_else(|| {
                project_tool_native_fact(
                    file,
                    imports,
                    local_initializers,
                    match_index,
                    source_match,
                    records_by_file,
                )
            })
            .or_else(|| {
                first_party_native_fact_from_table(
                    file,
                    imports,
                    local_initializers,
                    match_index,
                    source_match,
                    records_by_file,
                )
            })
            .or_else(|| {
                eval_native_fact(
                    file,
                    source_text,
                    imports,
                    local_initializers,
                    match_index,
                    source_match,
                    records_by_file,
                )
            })
            .or_else(|| {
                project_routing_native_fact(
                    file,
                    imports,
                    local_initializers,
                    match_index,
                    source_match,
                )
            })
            .map(|projection| (match_index, projection))
        })
        .collect::<Vec<_>>();
    projections.sort_by_key(|(match_index, _)| *match_index);
    projections
        .into_iter()
        .map(|(_, projection)| projection)
        .collect()
}

fn workspace_native_fact(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    let parts = context::call_parts(source_match)?;
    let context = PrimitiveContext::new_with_records(
        file,
        imports,
        local_initializers,
        &parts,
        records_by_file,
    );
    let facts = workspace_facts(&context, &parts)?;
    Some(StaticNativeFactProjection {
        match_index,
        replaces: vec![crate::protocol::StaticNativeFactExtractorIdentity {
            extension: "@crux/indexer/crux-core".to_string(),
            extractor: "workspace".to_string(),
        }],
        facts,
    })
}

/// Keeps legacy syntax-record replacement packets narrower than nativeStatic compilation.
fn should_skip_legacy_native_fact_packet(
    extractor: &str,
    parts: &CallParts<'_>,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> bool {
    records_by_file.is_none() && extractor == "prompt" && parts.callee_direct == Some(false)
}

fn eval_native_fact(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    let parts = context::call_parts(source_match)?;
    let context = PrimitiveContext::new_with_records(
        file,
        imports,
        local_initializers,
        &parts,
        records_by_file,
    );
    let facts = eval_facts(&context, &parts, source_text)?;
    Some(StaticNativeFactProjection {
        match_index,
        replaces: vec![crate::protocol::StaticNativeFactExtractorIdentity {
            extension: "@crux/indexer/crux-core".to_string(),
            extractor: "eval".to_string(),
        }],
        facts,
    })
}

fn first_party_native_fact_from_table(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    for (extractor, project) in FIRST_PARTY_PROJECTORS {
        if let Some(fact) = first_party_native_fact(
            file,
            imports,
            local_initializers,
            match_index,
            source_match,
            extractor,
            project,
            records_by_file,
        ) {
            return Some(fact);
        }
    }
    None
}

fn first_party_native_fact(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    extractor: &str,
    project: FirstPartyProjector,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    let parts = context::call_parts(source_match)?;
    if should_skip_legacy_native_fact_packet(extractor, &parts, records_by_file) {
        return None;
    }
    let context = PrimitiveContext::new_with_records(
        file,
        imports,
        local_initializers,
        &parts,
        records_by_file,
    );
    let facts = project(&context, &parts)?;
    Some(StaticNativeFactProjection {
        match_index,
        replaces: vec![crate::protocol::StaticNativeFactExtractorIdentity {
            extension: "@crux/indexer/crux-core".to_string(),
            extractor: extractor.to_string(),
        }],
        facts,
    })
}
