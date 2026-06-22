use crate::{
    native_routing_facts::project_routing_native_fact,
    protocol::{
        StaticImportRecord, StaticInitializerRecord, StaticNativeFactProjection, StaticSourceMatch,
    },
};

/// Projects first-party static facts that the native syntax frontend can prove completely.
///
/// This gate is intentionally strict: a primitive is either covered for its full supported static
/// extractor contract or it emits no native packet and falls back to the TypeScript extension
/// runtime. Partial "simple" primitive packets are not allowed because they hide coverage gaps and
/// can suppress user extensions that inspect the same source match.
pub(crate) fn project_native_facts(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    matches: &[StaticSourceMatch],
) -> Vec<StaticNativeFactProjection> {
    matches
        .iter()
        .enumerate()
        .filter_map(|(match_index, source_match)| {
            project_routing_native_fact(
                file,
                imports,
                local_initializers,
                match_index,
                source_match,
            )
        })
        .collect()
}
