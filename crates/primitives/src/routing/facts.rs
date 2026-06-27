use serde_json::Value;

use crate::{
    context::{PrimitiveContext, call_parts},
    manifest::CustomProjectionInput,
    routing::cascade::cascade_facts,
    routing::fallback::fallback_facts,
    routing::router::router_facts,
};

/// Projects the facts for one supported first-party routing match.
///
/// Routing dispatches over `router`/`cascade`/`fallback` and resolves only
/// same-file evidence, so it owns its match handling behind the manifest's
/// custom-handler entry. The manifest stamps the `routing` extractor identity.
pub(crate) fn routing_native_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    let parts = call_parts(input.source_match)?;
    if parts.callee_direct == Some(false) {
        return None;
    }
    let context =
        PrimitiveContext::new(input.file, input.imports, input.local_initializers, &parts);
    match parts.callee_name {
        "router" => router_facts(&context, &parts),
        "cascade" => cascade_facts(&context, &parts),
        "fallback" => fallback_facts(&context, &parts),
        _ => None,
    }
}
