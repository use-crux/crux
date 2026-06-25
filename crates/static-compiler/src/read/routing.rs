//! Routing child metadata projection from canonical relation edges.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::core::facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::read::helpers::definition_metadata;

pub(crate) fn with_resolved_routing_target_metadata(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticDefinition> {
    let targets = relations
        .iter()
        .filter_map(|relation| {
            routing_target_kind_for_relation(&relation.r#type).map(|target_kind| {
                (
                    relation.from.clone(),
                    (target_kind.to_string(), relation.to.clone()),
                )
            })
        })
        .collect::<BTreeMap<_, _>>();

    definitions
        .into_iter()
        .map(|mut definition| {
            let Some((target_kind, target_definition_id)) = targets.get(&definition.id) else {
                return definition;
            };
            let mut metadata = definition_metadata(&definition);
            metadata.insert("targetKind".to_string(), Value::String(target_kind.clone()));
            metadata.insert(
                "targetDefinitionId".to_string(),
                Value::String(target_definition_id.clone()),
            );
            definition.metadata = Some(Value::Object(metadata));
            definition
        })
        .collect()
}

fn routing_target_kind_for_relation(relation_type: &str) -> Option<&'static str> {
    if !is_routing_target_relation(relation_type) {
        return None;
    }
    if relation_type.ends_with(".uses_router") {
        return Some("routing.router");
    }
    if relation_type.ends_with(".uses_cascade") {
        return Some("routing.cascade");
    }
    if relation_type.ends_with(".uses_fallback") {
        return Some("routing.fallback");
    }
    if relation_type.ends_with(".uses_agent") {
        return Some("agent");
    }
    if relation_type.ends_with(".uses_prompt") {
        return Some("prompt");
    }
    None
}

fn is_routing_target_relation(relation_type: &str) -> bool {
    relation_type.starts_with("router.route.uses_")
        || relation_type.starts_with("cascade.tier.uses_")
        || relation_type.starts_with("fallback.option.uses_")
}
