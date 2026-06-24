use serde_json::{Map, Value, json};

use crate::{
    primitives::definition::{
        NativeDefinitionInput, folded_index_child, native_static_definition, safe_id,
    },
    primitives::record_values::{
        direct_string_property, has_property, json_object_property, number_property,
        object_array_value, object_value, property_value, reference_property,
    },
    primitives::routing_model::{CallParts, RoutingContext, source_ref_for_property},
    primitives::routing_output::{
        child_facts_with_target, extracted_facts, insert_number, insert_string, metadata_bool,
        routing_target_relation_refs,
    },
    protocol::StaticSyntaxValue,
};

pub(crate) fn cascade_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = object_value(parts.object_arg?)?;
    let tiers = object_array_value(property_value(config, "tiers"), &context.initializers);
    if tiers.is_empty() {
        return None;
    }

    let authored_id = direct_string_property(config, "id");
    let routing_id = authored_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("routing.cascade:{}", safe_id(&routing_id));
    let mut tier_children = Vec::new();
    for (index, tier) in tiers.iter().enumerate() {
        tier_children.push(tier_child(context, parts, &id, &routing_id, tier, index)?);
    }

    let child_ids = tier_children
        .iter()
        .map(|(definition_id, _, _)| definition_id.clone())
        .collect::<Vec<_>>();
    let budget = json_object_property(config, Some("budget"), &context.initializers)?;
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("routingId".to_string(), Value::String(routing_id.clone()));
    metadata.insert(
        "hasStableId".to_string(),
        Value::Bool(authored_id.is_some()),
    );
    if let Some(authored_id) = authored_id {
        metadata.insert("authoredId".to_string(), Value::String(authored_id));
    }
    metadata.insert("tierCount".to_string(), json!(tier_children.len()));
    metadata.insert(
        "hasBudget".to_string(),
        Value::Bool(has_property(config, "budget")),
    );
    if let Some(budget) = budget.clone() {
        metadata.insert("budget".to_string(), budget);
    }
    metadata.insert(
        "facts".to_string(),
        parent_facts(&routing_id, &metadata, tier_children.len(), budget),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "cascade", "ordering": "ordered", "children": child_ids}}),
    );

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "routing.cascade",
            name: routing_id,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        tier_children.iter().map(|(_, definition, _)| definition.clone()).collect(),
        tier_children
            .iter()
            .map(|(definition_id, _, _)| json!({"type": "cascade.includes_tier", "toId": definition_id}))
            .chain(tier_children.iter().flat_map(|(definition_id, _, target)| {
                routing_target_relation_refs(definition_id, target.as_deref(), "cascade.tier")
            }))
            .collect(),
        Vec::new(),
    ))
}

fn tier_child(
    context: &RoutingContext<'_>,
    parts: &CallParts<'_>,
    cascade_id: &str,
    routing_id: &str,
    tier: &StaticSyntaxValue,
    index: usize,
) -> Option<(String, Value, Option<String>)> {
    let definition_id = format!("{cascade_id}:tier:{}", index + 1);
    let target_variable = reference_property(tier, "model", &context.initializers);
    let mut metadata = Map::new();
    metadata.insert(
        "cascadeDefinitionId".to_string(),
        Value::String(cascade_id.to_string()),
    );
    metadata.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    metadata.insert("tierIndex".to_string(), json!(index));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(cascade_id, "cascade.includes_tier", "tier", index),
    );
    if let Some(target_variable) = &target_variable {
        metadata.insert(
            "targetVariable".to_string(),
            Value::String(target_variable.clone()),
        );
        metadata.insert(
            "modelVariable".to_string(),
            Value::String(target_variable.clone()),
        );
    }
    insert_number(
        &mut metadata,
        "budget",
        number_property(tier, "budget", &context.initializers),
    );
    insert_string(&mut metadata, "note", direct_string_property(tier, "note"));
    metadata.insert(
        "hasEvaluate".to_string(),
        Value::Bool(has_property(tier, "evaluate")),
    );
    metadata.insert(
        "facts".to_string(),
        child_facts_with_target(
            "routing.cascade.tier",
            cascade_id,
            routing_id,
            "tierIndex",
            index,
            target_variable.as_deref(),
            Some(("hasEvaluate", Value::Bool(has_property(tier, "evaluate")))),
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "cascade", "ordering": "ordered"}}),
    );
    let mut definition = native_static_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "routing.cascade.tier",
        name: format!("tier {}", index + 1),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    if let Some(source_ref) = source_ref_for_property(context, &definition_id, tier, "evaluate")? {
        if let Value::Object(definition_object) = &mut definition {
            definition_object.insert("sourceRefs".to_string(), json!([source_ref["ref"].clone()]));
        }
    }
    Some((definition_id, definition, target_variable))
}

fn parent_facts(
    routing_id: &str,
    metadata: &Map<String, Value>,
    tier_count: usize,
    budget: Option<Value>,
) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("routing.cascade".to_string()),
    );
    facts.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    facts.insert(
        "hasStableId".to_string(),
        Value::Bool(metadata_bool(metadata, "hasStableId")),
    );
    facts.insert("tierCount".to_string(), json!(tier_count));
    facts.insert(
        "hasBudget".to_string(),
        Value::Bool(metadata_bool(metadata, "hasBudget")),
    );
    if let Some(budget) = budget {
        facts.insert("budget".to_string(), budget);
    }
    Value::Object(facts)
}
