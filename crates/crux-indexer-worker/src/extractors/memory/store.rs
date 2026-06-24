use serde_json::{Map, Value, json};

use crate::{
    extractors::context::{CallParts, PrimitiveContext},
    extractors::definition::{NativeDefinitionInput, native_static_definition, safe_id},
    extractors::record_values::{
        direct_string_property, property_value, reference_property, resolve_static_value,
    },
    protocol::StaticSyntaxValue,
};

pub(crate) struct StoreInfo {
    pub(crate) name: String,
    pub(crate) backend: Option<String>,
    pub(crate) variable_name: Option<String>,
    pub(crate) component: Option<String>,
}

pub(crate) fn authored_store(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<StoreInfo> {
    let store_value = property_value(config, "store")?;
    let variable_name = reference_property(config, "store", &context.initializers);
    let resolved =
        resolve_static_value(store_value, &context.initializers, &mut Default::default());
    let StaticSyntaxValue::Call { callee, args, .. } = resolved else {
        return variable_name.clone().map(|name| StoreInfo {
            name,
            backend: None,
            variable_name,
            component: None,
        });
    };
    let backend = Some(callee.name.clone());
    let component = args.first().and_then(|arg| store_component(context, arg));
    Some(StoreInfo {
        name: variable_name.clone().unwrap_or_else(|| callee.name.clone()),
        backend,
        variable_name,
        component,
    })
}

pub(crate) fn store_definition(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    owner_key: &str,
    parent_definition_id: &str,
    parent_relation_type: &str,
    store: &StoreInfo,
) -> Value {
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert(
        "ownerDefinitionKey".to_string(),
        Value::String(owner_key.to_string()),
    );
    metadata.insert(
        "indexPresentation".to_string(),
        json!({
            "standalone": false,
            "parentDefinitionId": parent_definition_id,
            "parentRelationType": parent_relation_type,
            "role": "store",
        }),
    );
    insert_string(&mut metadata, "backend", store.backend.clone());
    insert_string(&mut metadata, "variableName", store.variable_name.clone());
    insert_string(&mut metadata, "component", store.component.clone());
    metadata.insert("facts".to_string(), store_fact_metadata(owner_key, store));
    native_static_definition(NativeDefinitionInput {
        id: format!(
            "memory.store:{}:{}",
            safe_id(owner_key),
            safe_id(&store.name)
        ),
        kind: "memory.store",
        name: store.name.clone(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    })
}

pub(crate) fn authored_store_name(store: Option<&StoreInfo>) -> Option<String> {
    store.and_then(|store| store.backend.clone().or_else(|| Some(store.name.clone())))
}

pub(crate) fn store_id(definition: &Value) -> Option<String> {
    definition
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn store_fact_metadata(owner_key: &str, store: &StoreInfo) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("memory.store".to_string()),
    );
    facts.insert(
        "ownerDefinitionKey".to_string(),
        Value::String(owner_key.to_string()),
    );
    insert_string(&mut facts, "backend", store.backend.clone());
    insert_string(&mut facts, "variableName", store.variable_name.clone());
    insert_string(&mut facts, "component", store.component.clone());
    Value::Object(facts)
}

fn store_component(context: &PrimitiveContext<'_>, value: &StaticSyntaxValue) -> Option<String> {
    direct_string_property(value, "component")
        .or_else(|| reference_property(value, "component", &context.initializers))
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}
