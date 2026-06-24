use serde_json::{Map, Value, json};

use crate::{
    extractors::context::{CallParts, PrimitiveContext},
    extractors::definition::{NativeDefinitionInput, native_static_definition},
    extractors::memory::id::authored_memory_id,
    extractors::memory::store::{authored_store, authored_store_name, store_definition, store_id},
    extractors::record_values::{direct_string_property, property_value},
    extractors::routing::output::extracted_facts,
    extractors::schema::syntax_value_to_json_schema,
};

pub(crate) fn blackboard_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "blackboard" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let id_info = authored_memory_id(context, config);
    let definition_key = id_info
        .definition_key
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!(
        "blackboard:{}",
        crate::extractors::definition::safe_id(&definition_key)
    );
    let store = authored_store(context, config);
    let store_definition = store.as_ref().map(|store| {
        store_definition(
            context,
            parts,
            &definition_key,
            &id,
            "blackboard.uses_store",
            store,
        )
    });
    let schema = property_value(config, "schema")
        .and_then(|value| syntax_value_to_json_schema(Some(value), context));

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(schema) = schema.clone() {
        metadata.insert("schema".to_string(), schema.clone());
    }
    metadata.insert(
        "facts".to_string(),
        blackboard_fact_metadata(store.as_ref(), config, id_info.runtime_id_prefix.as_deref()),
    );
    insert_string(
        &mut metadata,
        "backend",
        authored_store_name(store.as_ref()),
    );
    insert_string(
        &mut metadata,
        "conflictPolicy",
        direct_string_property(config, "conflictPolicy"),
    );
    insert_string(
        &mut metadata,
        "runtimeIdPrefix",
        id_info.runtime_id_prefix.clone(),
    );
    metadata.insert(
        "intelligence".to_string(),
        blackboard_intelligence(
            schema.as_ref(),
            store_definition.as_ref().and_then(store_id),
        ),
    );

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "blackboard",
            name: id_info
                .display_name
                .unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        store_definition.iter().cloned().collect(),
        store_definition
            .as_ref()
            .and_then(store_id)
            .map(|to_id| vec![json!({"type": "blackboard.uses_store", "toId": to_id})])
            .unwrap_or_default(),
        Vec::new(),
    ))
}

fn blackboard_fact_metadata(
    store: Option<&crate::extractors::memory::store::StoreInfo>,
    config: &crate::protocol::StaticSyntaxValue,
    runtime_id_prefix: Option<&str>,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("blackboard".to_string()));
    insert_string(&mut facts, "backend", authored_store_name(store));
    insert_string(
        &mut facts,
        "conflictPolicy",
        direct_string_property(config, "conflictPolicy"),
    );
    insert_string(
        &mut facts,
        "runtimeIdPrefix",
        runtime_id_prefix.map(str::to_string),
    );
    Value::Object(facts)
}

fn blackboard_intelligence(schema: Option<&Value>, store_id: Option<String>) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = schema {
        intelligence.insert("contract".to_string(), json!({ "schema": schema }));
    }
    if let Some(store_id) = store_id {
        intelligence.insert("dependencies".to_string(), json!({ "stores": [store_id] }));
    }
    Value::Object(intelligence)
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}
