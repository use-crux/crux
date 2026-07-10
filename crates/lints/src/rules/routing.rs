//! Routing-specific predicates for native built-in graph lints.

use serde_json::Value;

use crate::facts::{StaticIndexDefinition, StaticIndexRelation};
use crate::helpers::metadata_str;

pub(crate) fn is_routing_root(definition: &StaticIndexDefinition) -> bool {
    matches!(
        definition.kind.as_str(),
        "routing.router"
            | "routing.split"
            | "routing.retry"
            | "routing.cascade"
            | "routing.fallback"
    )
}

pub(crate) fn is_routing_child(definition: &StaticIndexDefinition) -> bool {
    matches!(
        definition.kind.as_str(),
        "routing.router.route"
            | "routing.split.route"
            | "routing.retry.target"
            | "routing.cascade.tier"
            | "routing.fallback.option"
    )
}

pub(crate) fn routing_child_has_unresolved_target(
    definition: &StaticIndexDefinition,
    outgoing_relations: &[&StaticIndexRelation],
) -> bool {
    routing_target_variable(definition).is_some()
        && !outgoing_relations
            .iter()
            .any(|relation| relation.r#type.contains(".uses_"))
        && !has_routing_target_source_ref(definition)
}

pub(crate) fn routing_target_variable(definition: &StaticIndexDefinition) -> Option<&str> {
    metadata_str(definition, "targetVariable")
        .or_else(|| metadata_str(definition, "modelVariable"))
        .filter(|value| !value.is_empty())
}

pub(crate) fn has_routing_target_source_ref(definition: &StaticIndexDefinition) -> bool {
    definition.source_refs.iter().any(|source_ref| {
        source_ref
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("routingTarget"))
            .and_then(Value::as_bool)
            == Some(true)
    })
}
