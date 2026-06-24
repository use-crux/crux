//! Routing-specific predicates for native built-in graph lints.

use serde_json::Value;

use crate::native_static_facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::native_static_lint_helpers::metadata_str;

pub(crate) fn is_routing_root(definition: &NativeStaticDefinition) -> bool {
    matches!(
        definition.kind.as_str(),
        "routing.router" | "routing.cascade" | "routing.fallback"
    )
}

pub(crate) fn is_routing_child(definition: &NativeStaticDefinition) -> bool {
    matches!(
        definition.kind.as_str(),
        "routing.router.route" | "routing.cascade.tier" | "routing.fallback.option"
    )
}

pub(crate) fn routing_child_has_unresolved_target(
    definition: &NativeStaticDefinition,
    outgoing_relations: &[&NativeStaticRelation],
) -> bool {
    routing_target_variable(definition).is_some()
        && !outgoing_relations
            .iter()
            .any(|relation| relation.r#type.contains(".uses_"))
        && !has_routing_target_source_ref(definition)
}

pub(crate) fn routing_target_variable(definition: &NativeStaticDefinition) -> Option<&str> {
    metadata_str(definition, "targetVariable")
        .or_else(|| metadata_str(definition, "modelVariable"))
        .filter(|value| !value.is_empty())
}

pub(crate) fn has_routing_target_source_ref(definition: &NativeStaticDefinition) -> bool {
    definition.source_refs.iter().any(|source_ref| {
        source_ref
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("routingTarget"))
            .and_then(Value::as_bool)
            == Some(true)
    })
}
