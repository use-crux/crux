use serde_json::{Map, Value, json};

use crate::{
    composition::output::{CompositionChild, composition_child_definitions},
    composition::relations::composition_references,
    composition::values::{identifier_array, insert_string, insert_string_array},
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    record_values::{
        direct_string_property, object_map_identifier_entries, property_value, reference_property,
    },
    routing::output::extracted_facts,
};

pub(crate) fn composition_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_direct == Some(false) {
        return None;
    }
    let kind = composition_kind(parts.callee_name)?;
    let config = parts.object_arg?;
    // `id` is a required authored field on every composition primitive. Without a
    // direct string id there is no stable canonical identity for a runtime span to
    // join back against, so emit no composition definition rather than an
    // anonymous one keyed to the local variable name.
    let authored_id = direct_string_property(config, "id")?;
    let id = format!("{kind}:{}", safe_id(&authored_id));
    let children = composition_child_definitions(context, parts, config, &id);
    let metadata_projection = composition_metadata(context, parts.callee_name, config);
    let metadata = parent_metadata(parts, kind, metadata_projection, &children);
    let references = composition_references(context, parts.callee_name, config, &id, &children);

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind,
            name: authored_id,
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        children
            .iter()
            .map(|child| child.definition.clone())
            .collect(),
        references,
        Vec::new(),
    ))
}

fn parent_metadata(
    parts: &CallParts<'_>,
    kind: &str,
    projection: Map<String, Value>,
    children: &[CompositionChild],
) -> Map<String, Value> {
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.extend(projection.clone());
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String(kind.to_string()));
    facts.extend(projection);
    metadata.insert("facts".to_string(), Value::Object(facts));
    metadata.insert(
        "intelligence".to_string(),
        composition_intelligence(parts.callee_name, children),
    );
    metadata
}

fn composition_metadata(
    context: &PrimitiveContext<'_>,
    call_name: &str,
    config: &StaticSyntaxValue,
) -> Map<String, Value> {
    let mut metadata = Map::new();
    match call_name {
        "consensus" => {
            insert_string_array(
                &mut metadata,
                "participants",
                identifier_array(context, config, "agents"),
            );
            insert_string(
                &mut metadata,
                "judge",
                reference_property(config, "judge", &context.initializers),
            );
            insert_string(
                &mut metadata,
                "scorer",
                reference_property(config, "scorer", &context.initializers),
            );
        }
        "swarm" => {
            let participants = object_map_identifier_entries(
                property_value(config, "agents"),
                &context.initializers,
            )
            .into_iter()
            .map(|(_, value)| value)
            .collect::<Vec<_>>();
            insert_string(
                &mut metadata,
                "coordinator",
                direct_string_property(config, "startAgent"),
            );
            insert_string_array(&mut metadata, "participants", participants);
            insert_string(
                &mut metadata,
                "sharedBlackboard",
                reference_property(config, "blackboard", &context.initializers),
            );
            let memories = identifier_array(context, config, "memory");
            if memories.is_empty() {
                insert_string(
                    &mut metadata,
                    "sharedMemory",
                    reference_property(config, "memory", &context.initializers),
                );
            } else {
                metadata.insert("sharedMemory".to_string(), json!(memories));
            }
        }
        _ => {}
    }
    metadata
}

fn composition_intelligence(call_name: &str, children: &[CompositionChild]) -> Value {
    let mut control = Map::new();
    control.insert(
        "mode".to_string(),
        Value::String(mode_for_call(call_name).to_string()),
    );
    control.insert(
        "ordering".to_string(),
        Value::String(ordering_for_call(call_name).to_string()),
    );
    if !children.is_empty() {
        control.insert(
            "children".to_string(),
            json!(children.iter().map(|child| &child.id).collect::<Vec<_>>()),
        );
    }
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    intelligence.insert("control".to_string(), Value::Object(control));
    if !children.is_empty() {
        intelligence.insert(
            "children".to_string(),
            json!(children.iter().map(|child| &child.id).collect::<Vec<_>>()),
        );
    }
    Value::Object(intelligence)
}

fn composition_kind(call_name: &str) -> Option<&'static str> {
    match call_name {
        "parallel" => Some("composition.parallel"),
        "pipeline" => Some("composition.pipeline"),
        "consensus" => Some("composition.consensus"),
        "swarm" => Some("composition.swarm"),
        _ => None,
    }
}

fn mode_for_call(call_name: &str) -> &'static str {
    match call_name {
        "parallel" => "parallel",
        "pipeline" => "sequential",
        "consensus" => "consensus",
        "swarm" => "swarm",
        _ => "immediate",
    }
}

fn ordering_for_call(call_name: &str) -> &'static str {
    match call_name {
        "parallel" => "concurrent",
        "pipeline" => "ordered",
        "consensus" => "concurrent",
        "swarm" => "event-driven",
        _ => "unknown",
    }
}
