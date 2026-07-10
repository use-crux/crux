use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    record_values::{direct_string_property, model_reference, number_property, object_value},
    routing::output::{
        child_facts_with_target, extracted_facts, insert_string, routing_target_relation_refs,
    },
};

pub(crate) fn retry_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let model = parts.args.first()?;
    let target = model_reference(model, &context.initializers)?;
    let config = parts.args.get(1).and_then(object_value);

    let authored_id = config.and_then(|object| direct_string_property(object, "id"));
    let routing_id = authored_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("routing.retry:{}", safe_id(&routing_id));
    let target_child = target_child(context, parts, &id, &routing_id, &target);
    let attempts =
        config.and_then(|object| number_property(object, "attempts", &context.initializers));

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
    if let Some(attempts) = attempts {
        metadata.insert("attempts".to_string(), json!(attempts));
    }
    if let Some(config) = config {
        insert_string(
            &mut metadata,
            "backoff",
            direct_string_property(config, "backoff"),
        );
    }
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "routing.retry",
            "routingId": routing_id,
            "hasStableId": metadata.get("hasStableId").and_then(Value::as_bool).unwrap_or(false),
            "attempts": attempts,
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "ordered", "children": [target_child.0.clone()]}}),
    );

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "routing.retry",
            name: routing_id,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        vec![target_child.1.clone()],
        vec![json!({"type": "retry.uses_target", "toId": target_child.0})]
            .into_iter()
            .chain(routing_target_relation_refs(
                &target_child.0,
                Some(&target),
                "retry.target",
            ))
            .collect(),
        Vec::new(),
    ))
}

fn target_child(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    retry_id: &str,
    routing_id: &str,
    target: &str,
) -> (String, Value) {
    let definition_id = format!("{retry_id}:target:1");
    let mut metadata = Map::new();
    metadata.insert(
        "retryDefinitionId".to_string(),
        Value::String(retry_id.to_string()),
    );
    metadata.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    metadata.insert("targetIndex".to_string(), json!(0));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(retry_id, "retry.uses_target", "option", 0),
    );
    metadata.insert(
        "targetVariable".to_string(),
        Value::String(target.to_string()),
    );
    metadata.insert(
        "modelVariable".to_string(),
        Value::String(target.to_string()),
    );
    metadata.insert(
        "facts".to_string(),
        child_facts_with_target(
            "routing.retry.target",
            retry_id,
            routing_id,
            "targetIndex",
            0,
            Some(target),
            None,
        ),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "ordered"}}),
    );
    let definition = static_index_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "routing.retry.target",
        name: "target".to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    (definition_id, definition)
}
