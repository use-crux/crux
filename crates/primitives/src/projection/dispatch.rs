//! Manifest-driven dispatch for first-party Static Index primitive projection.
//!
//! Each source match is projected by walking the
//! [`FIRST_PARTY_PRIMITIVE_MANIFEST`] in order and taking the first entry that
//! produces a packet. The manifest owns dispatch order, the matched call
//! surface, the reference forms each entry can resolve, and the `replaces`
//! extractor identity; handlers own the projection itself.

use std::collections::HashMap;

use rayon::prelude::*;
use serde_json::Value;

use crate::{
    context::{self, CallParts, PrimitiveContext},
    manifest::{
        CustomProjectionInput, FIRST_PARTY_PRIMITIVE_MANIFEST, FirstPartyPrimitive, Projector,
    },
    protocol::{
        StaticImportRecord, StaticInitializerRecord, StaticNativeFactProjection, StaticSourceMatch,
        StaticSyntaxFileRecord,
    },
};

/// Projects first-party facts for every matched source shape.
///
/// Results are returned in match order so downstream finalization stays stable.
pub(crate) fn project_first_party_facts(
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
            project_match(
                file,
                source_text,
                imports,
                local_initializers,
                match_index,
                source_match,
                records_by_file,
            )
        })
        .collect::<Vec<_>>();
    projections.sort_by_key(|projection| projection.match_index);
    projections
}

/// Resolves the first manifest entry that projects a packet for one match.
fn project_match(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Option<StaticNativeFactProjection> {
    // Build the shared call context once per match. Entries that resolve
    // imported references use the scoped context; entries restricted to local
    // evidence use the no-records context. Custom handlers build their own.
    let parts = context::call_parts(source_match);
    let scoped_context = parts.as_ref().map(|parts| {
        PrimitiveContext::new_with_records(
            file,
            imports,
            local_initializers,
            parts,
            records_by_file,
        )
    });
    let local_context = parts
        .as_ref()
        .map(|parts| PrimitiveContext::new(file, imports, local_initializers, parts));

    for entry in FIRST_PARTY_PRIMITIVE_MANIFEST {
        let custom_input = CustomProjectionInput {
            file,
            imports,
            local_initializers,
            source_match,
            records_by_file,
        };
        let facts = project_entry(
            entry,
            parts.as_ref(),
            scoped_context.as_ref(),
            local_context.as_ref(),
            source_text,
            records_by_file.is_none(),
            &custom_input,
        );
        if let Some(facts) = facts {
            return Some(StaticNativeFactProjection {
                match_index,
                replaces: vec![entry.identity()],
                facts,
            });
        }
    }
    None
}

/// Runs one manifest entry's handler against the prepared inputs.
fn project_entry(
    entry: &FirstPartyPrimitive,
    parts: Option<&CallParts<'_>>,
    scoped_context: Option<&PrimitiveContext<'_>>,
    local_context: Option<&PrimitiveContext<'_>>,
    source_text: &str,
    records_absent: bool,
    custom_input: &CustomProjectionInput<'_>,
) -> Option<Value> {
    match &entry.projector {
        Projector::CallParts(project) => {
            let parts = call_parts_for(entry, parts, records_absent)?;
            project(
                reference_context(entry, scoped_context, local_context)?,
                parts,
            )
        }
        Projector::SourceText(project) => {
            let parts = call_parts_for(entry, parts, records_absent)?;
            project(
                reference_context(entry, scoped_context, local_context)?,
                parts,
                source_text,
            )
        }
        Projector::Custom(project) => project(custom_input),
    }
}

/// Gates a call-based entry on its declared call surface and legacy skip rule.
fn call_parts_for<'a>(
    entry: &FirstPartyPrimitive,
    parts: Option<&'a CallParts<'a>>,
    records_absent: bool,
) -> Option<&'a CallParts<'a>> {
    let parts = parts?;
    if !entry.matches_callee(parts.callee_name) {
        return None;
    }
    if entry.skip_legacy_indirect && records_absent && parts.callee_direct == Some(false) {
        return None;
    }
    Some(parts)
}

/// Picks the context matching the entry's declared reference forms.
fn reference_context<'a>(
    entry: &FirstPartyPrimitive,
    scoped_context: Option<&'a PrimitiveContext<'a>>,
    local_context: Option<&'a PrimitiveContext<'a>>,
) -> Option<&'a PrimitiveContext<'a>> {
    if entry.resolves_imported_records() {
        scoped_context
    } else {
        local_context
    }
}
