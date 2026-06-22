use crate::{
    native_routing_cascade::cascade_facts,
    native_routing_fallback::fallback_facts,
    native_routing_model::{RoutingContext, call_parts},
    native_routing_router::router_facts,
    protocol::{
        StaticImportRecord, StaticInitializerRecord, StaticNativeFactExtractorIdentity,
        StaticNativeFactProjection, StaticSourceMatch,
    },
};

/// Projects an exact native packet for one supported first-party routing match.
pub(crate) fn project_routing_native_fact(
    file: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    match_index: usize,
    source_match: &StaticSourceMatch,
) -> Option<StaticNativeFactProjection> {
    let parts = call_parts(source_match)?;
    if parts.callee_direct == Some(false) {
        return None;
    }
    let context = RoutingContext::new(file, imports, local_initializers, &parts);
    let facts = match parts.callee_name {
        "router" => router_facts(&context, &parts)?,
        "cascade" => cascade_facts(&context, &parts)?,
        "fallback" => fallback_facts(&context, &parts)?,
        _ => return None,
    };
    Some(StaticNativeFactProjection {
        match_index,
        replaces: vec![StaticNativeFactExtractorIdentity {
            extension: "@crux/indexer/crux-core".to_string(),
            extractor: "routing".to_string(),
        }],
        facts,
    })
}
