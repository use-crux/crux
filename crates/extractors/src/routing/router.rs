use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext, source_ref_for_property},
    definition::{NativeDefinitionInput, folded_index_child, native_static_definition, safe_id},
    record_values::{
        direct_string_property, has_property, object_map_identifier_entries, object_value,
        property_value,
    },
    routing::output::{extracted_facts, routing_target_relation_refs},
};

pub(crate) fn router_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = object_value(parts.object_arg?)?;
    let routes =
        object_map_identifier_entries(property_value(config, "routes"), &context.initializers);
    if routes.is_empty() {
        return None;
    }

    let authored_id = direct_string_property(config, "id");
    let routing_id = authored_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("routing.router:{}", safe_id(&routing_id));
    let route_children = routes
        .iter()
        .enumerate()
        .map(|(index, (route_key, target_variable))| {
            route_child(
                context,
                parts,
                &id,
                &routing_id,
                route_key,
                target_variable,
                index,
            )
        })
        .collect::<Vec<_>>();

    let classify_ref = match source_ref_for_property(context, &id, config, "classify")? {
        Some(source_ref) => vec![source_ref],
        None => Vec::new(),
    };
    let route_keys = routes
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    let child_ids = route_children
        .iter()
        .map(|(definition_id, _, _)| definition_id.clone())
        .collect::<Vec<_>>();

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
    metadata.insert("routeKeys".to_string(), json!(route_keys));
    metadata.insert("routeCount".to_string(), json!(routes.len()));
    metadata.insert(
        "hasDefaultRoute".to_string(),
        Value::Bool(routes.iter().any(|(key, _)| key == "default")),
    );
    metadata.insert(
        "hasClassify".to_string(),
        Value::Bool(has_property(config, "classify")),
    );
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "routing.router",
            "routingId": routing_id,
            "hasStableId": metadata.get("hasStableId").and_then(Value::as_bool).unwrap_or(false),
            "routeKeys": metadata.get("routeKeys").cloned().unwrap_or_else(|| json!([])),
            "routeCount": routes.len(),
            "hasDefaultRoute": metadata.get("hasDefaultRoute").and_then(Value::as_bool).unwrap_or(false),
            "hasClassify": has_property(config, "classify"),
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "conditional", "children": child_ids}}),
    );

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "routing.router",
            name: routing_id,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        route_children.iter().map(|(_, definition, _)| definition.clone()).collect(),
        route_children
            .iter()
            .map(|(definition_id, _, _)| json!({"type": "router.includes_route", "toId": definition_id}))
            .chain(route_children.iter().flat_map(|(definition_id, _, target)| {
                routing_target_relation_refs(definition_id, Some(target), "router.route")
            }))
            .collect(),
        classify_ref,
    ))
}

fn route_child(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    router_id: &str,
    routing_id: &str,
    route_key: &str,
    target_variable: &str,
    index: usize,
) -> (String, Value, String) {
    let definition_id = format!("{router_id}:route:{}", safe_id(route_key));
    let mut metadata = Map::new();
    metadata.insert(
        "routerDefinitionId".to_string(),
        Value::String(router_id.to_string()),
    );
    metadata.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    metadata.insert("routeKey".to_string(), Value::String(route_key.to_string()));
    metadata.insert("index".to_string(), json!(index));
    metadata.insert("isDefault".to_string(), Value::Bool(route_key == "default"));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(router_id, "router.includes_route", "route", index),
    );
    metadata.insert(
        "targetVariable".to_string(),
        Value::String(target_variable.to_string()),
    );
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "routing.router.route",
            "parentDefinitionId": router_id,
            "routingId": routing_id,
            "routeKey": route_key,
            "isDefault": route_key == "default",
            "targetVariable": target_variable,
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "conditional"}}),
    );
    let definition = native_static_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "routing.router.route",
        name: route_key.to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    (definition_id, definition, target_variable.to_string())
}
