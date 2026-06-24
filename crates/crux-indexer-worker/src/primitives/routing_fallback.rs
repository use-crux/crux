use serde_json::{Map, Value, json};

use crate::{
    primitives::definition::{
        NativeDefinitionInput, folded_index_child, native_static_definition, safe_id,
    },
    primitives::record_values::{
        direct_identifier, direct_string_property, fallback_model_preview, fallback_options,
        json_object_property, object_value,
    },
    primitives::routing_model::{CallParts, RoutingContext},
    primitives::routing_output::{
        extracted_facts, fallback_option_facts, fallback_parent_facts, routing_target_relation_refs,
    },
};

pub(crate) fn fallback_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg.and_then(object_value);
    let options = fallback_options(parts.args);
    if options.is_empty() {
        return None;
    }

    let routing_id = config.and_then(|object| direct_string_property(object, "id"));
    let id_name = routing_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("routing.fallback:{}", safe_id(&id_name));
    let option_children = options
        .iter()
        .enumerate()
        .map(|(index, option)| {
            option_child(context, parts, &id, routing_id.as_deref(), option, index)
        })
        .collect::<Vec<_>>();

    let child_ids = option_children
        .iter()
        .map(|(definition_id, _, _)| definition_id.clone())
        .collect::<Vec<_>>();
    let options_metadata = match config {
        Some(object) => json_object_property(object, None, &context.initializers)?,
        None => None,
    };

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("hasStableId".to_string(), Value::Bool(routing_id.is_some()));
    if let Some(routing_id) = &routing_id {
        metadata.insert("routingId".to_string(), Value::String(routing_id.clone()));
    }
    metadata.insert("optionCount".to_string(), json!(option_children.len()));
    if let Some(options_metadata) = options_metadata {
        metadata.insert("options".to_string(), options_metadata);
    }
    metadata.insert(
        "facts".to_string(),
        fallback_parent_facts(
            routing_id.as_deref(),
            routing_id.is_some(),
            option_children.len(),
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "fallback", "ordering": "ordered", "children": child_ids}}),
    );

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "routing.fallback",
            name: id_name,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        option_children.iter().map(|(_, definition, _)| definition.clone()).collect(),
        option_children
            .iter()
            .map(|(definition_id, _, _)| json!({"type": "fallback.includes_option", "toId": definition_id}))
            .chain(option_children.iter().flat_map(|(definition_id, _, target)| {
                routing_target_relation_refs(definition_id, target.as_deref(), "fallback.option")
            }))
            .collect(),
        Vec::new(),
    ))
}

fn option_child(
    context: &RoutingContext<'_>,
    parts: &CallParts<'_>,
    fallback_id: &str,
    routing_id: Option<&str>,
    option: &crate::protocol::StaticSyntaxValue,
    index: usize,
) -> (String, Value, Option<String>) {
    let definition_id = format!("{fallback_id}:option:{}", index + 1);
    let target_variable = direct_identifier(option);
    let mut metadata = Map::new();
    metadata.insert(
        "fallbackDefinitionId".to_string(),
        Value::String(fallback_id.to_string()),
    );
    if let Some(routing_id) = routing_id {
        metadata.insert(
            "routingId".to_string(),
            Value::String(routing_id.to_string()),
        );
    }
    metadata.insert("optionIndex".to_string(), json!(index));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(fallback_id, "fallback.includes_option", "option", index),
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
    if let Some(model_preview) = fallback_model_preview(option) {
        metadata.insert("modelPreview".to_string(), model_preview);
    }
    metadata.insert(
        "facts".to_string(),
        fallback_option_facts(fallback_id, routing_id, index, target_variable.as_deref()),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "fallback", "ordering": "ordered"}}),
    );
    let definition = native_static_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "routing.fallback.option",
        name: format!("option {}", index + 1),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    (definition_id, definition, target_variable)
}
