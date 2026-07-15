use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext, source_ref_for_property},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    record_values::{
        call_profile_params, direct_string_property, has_property, model_reference,
        number_property, object_value, property_value,
    },
    routing::output::{extracted_facts, routing_target_relation_refs},
};

pub(crate) fn split_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = object_value(parts.object_arg?)?;
    let routes = split_route_entries(config, context);
    if routes.is_empty() {
        return None;
    }

    let authored_id = direct_string_property(config, "id");
    let routing_id = authored_id
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!("routing.split:{}", safe_id(&routing_id));
    let route_children = routes
        .iter()
        .enumerate()
        .map(|(index, route)| route_child(context, parts, &id, &routing_id, route, index))
        .collect::<Vec<_>>();

    let seed_ref = match source_ref_for_property(context, &id, config, "seed")? {
        Some(source_ref) => vec![source_ref],
        None => Vec::new(),
    };
    let route_keys = routes
        .iter()
        .map(|route| route.key.clone())
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
        "hasSeed".to_string(),
        Value::Bool(has_property(config, "seed")),
    );
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "routing.split",
            "routingId": routing_id,
            "hasStableId": metadata.get("hasStableId").and_then(Value::as_bool).unwrap_or(false),
            "routeKeys": metadata.get("routeKeys").cloned().unwrap_or_else(|| json!([])),
            "routeCount": routes.len(),
            "hasSeed": has_property(config, "seed"),
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "conditional", "children": child_ids}}),
    );

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "routing.split",
            name: routing_id,
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        route_children
            .iter()
            .map(|(_, definition, _)| definition.clone())
            .collect(),
        route_children
            .iter()
            .map(|(definition_id, _, _)| json!({"type": "split.includes_route", "toId": definition_id}))
            .chain(route_children.iter().flat_map(|(definition_id, _, target)| {
                routing_target_relation_refs(definition_id, Some(target), "split.route")
            }))
            .collect(),
        seed_ref,
    ))
}

struct SplitRoute {
    key: String,
    target: String,
    weight: Option<f64>,
    profile: Option<Value>,
}

fn split_route_entries(
    config: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Vec<SplitRoute> {
    let Some(StaticSyntaxValue::Object { properties, .. }) = property_value(config, "routes")
    else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .filter_map(|property| {
            model_reference(&property.value, &context.initializers).map(|target| SplitRoute {
                key: property.name.clone(),
                target,
                weight: number_property(&property.value, "weight", &context.initializers),
                profile: call_profile_params(&property.value, &context.initializers),
            })
        })
        .collect()
}

fn route_child(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    split_id: &str,
    routing_id: &str,
    route: &SplitRoute,
    index: usize,
) -> (String, Value, String) {
    let definition_id = format!("{split_id}:route:{}", safe_id(&route.key));
    let mut metadata = Map::new();
    metadata.insert(
        "splitDefinitionId".to_string(),
        Value::String(split_id.to_string()),
    );
    metadata.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    metadata.insert("routeKey".to_string(), Value::String(route.key.clone()));
    metadata.insert("index".to_string(), json!(index));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(split_id, "split.includes_route", "route", index),
    );
    metadata.insert(
        "targetVariable".to_string(),
        Value::String(route.target.clone()),
    );
    metadata.insert(
        "modelVariable".to_string(),
        Value::String(route.target.clone()),
    );
    if let Some(weight) = route.weight {
        metadata.insert("weight".to_string(), json!(weight));
    }
    if let Some(profile) = &route.profile {
        metadata.insert("profile".to_string(), profile.clone());
    }
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("routing.split.route".to_string()),
    );
    facts.insert(
        "parentDefinitionId".to_string(),
        Value::String(split_id.to_string()),
    );
    facts.insert(
        "routingId".to_string(),
        Value::String(routing_id.to_string()),
    );
    facts.insert("routeKey".to_string(), Value::String(route.key.clone()));
    facts.insert("weight".to_string(), json!(route.weight));
    facts.insert(
        "targetVariable".to_string(),
        Value::String(route.target.clone()),
    );
    if let Some(profile) = &route.profile {
        facts.insert("profile".to_string(), profile.clone());
    }
    metadata.insert("facts".to_string(), Value::Object(facts));
    metadata.insert(
        "intelligence".to_string(),
        json!({"confidence": "static", "control": {"mode": "routing", "ordering": "conditional"}}),
    );
    let definition = static_index_definition(NativeDefinitionInput {
        id: definition_id.clone(),
        kind: "routing.split.route",
        name: route.key.clone(),
        file: context.fingerprint_file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    (definition_id, definition, route.target.clone())
}
