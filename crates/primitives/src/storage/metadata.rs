use serde_json::{Map, Value, json};

use crate::storage::{
    capabilities::StorageFactoryDescriptor,
    dependencies::{StorageReferences, storage_dependency_map},
};

pub(crate) fn factory_metadata(
    variable_name: &str,
    descriptor: StorageFactoryDescriptor,
) -> Map<String, Value> {
    let capabilities = descriptor.capabilities;
    storage_metadata(
        descriptor.kind,
        variable_name,
        [
            (
                "backend",
                Some(Value::String(descriptor.backend.to_string())),
            ),
            ("capabilities", capabilities.clone()),
            (
                "facts",
                Some(storage_facts(
                    descriptor.kind,
                    variable_name,
                    Some(descriptor.backend.to_string()),
                    capabilities,
                    StorageReferences::default(),
                    None,
                )),
            ),
            ("intelligence", Some(json!({ "confidence": "static" }))),
        ],
    )
}

pub(crate) fn bundle_metadata(
    variable_name: &str,
    backend: Option<&str>,
    refs: &StorageReferences,
) -> Map<String, Value> {
    storage_metadata(
        "storage.bundle",
        variable_name,
        [
            (
                "backend",
                backend.map(|value| Value::String(value.to_string())),
            ),
            ("recordsVariable", refs.records.clone().map(Value::String)),
            ("vectorsVariable", refs.vectors.clone().map(Value::String)),
            ("blobsVariable", refs.blobs.clone().map(Value::String)),
            (
                "facts",
                Some(storage_facts(
                    "storage.bundle",
                    variable_name,
                    backend.map(str::to_string),
                    None,
                    refs.clone(),
                    None,
                )),
            ),
            (
                "intelligence",
                Some(
                    json!({ "confidence": "static", "dependencies": storage_dependency_map(refs) }),
                ),
            ),
        ],
    )
}

pub(crate) fn scope_metadata(
    variable_name: &str,
    base_storage: Option<&str>,
    prefix: Option<&str>,
) -> Map<String, Value> {
    let refs = StorageReferences {
        storage: base_storage.map(str::to_string),
        ..StorageReferences::default()
    };
    storage_metadata(
        "storage.scope",
        variable_name,
        [
            (
                "baseStorageVariable",
                base_storage.map(|value| Value::String(value.to_string())),
            ),
            (
                "prefix",
                prefix.map(|value| Value::String(value.to_string())),
            ),
            (
                "facts",
                Some(storage_facts(
                    "storage.scope",
                    variable_name,
                    None,
                    None,
                    refs.clone(),
                    prefix,
                )),
            ),
            (
                "intelligence",
                Some(
                    json!({ "confidence": "static", "dependencies": storage_dependency_map(&refs) }),
                ),
            ),
        ],
    )
}

fn storage_metadata<const N: usize>(
    kind: &str,
    variable_name: &str,
    entries: [(&str, Option<Value>); N],
) -> Map<String, Value> {
    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(variable_name.to_string()),
    );
    metadata.insert(
        "variableName".to_string(),
        Value::String(variable_name.to_string()),
    );
    metadata.insert("kind".to_string(), Value::String(kind.to_string()));
    for (key, value) in entries {
        if let Some(value) = value {
            metadata.insert(key.to_string(), value);
        }
    }
    metadata
}

fn storage_facts(
    kind: &str,
    variable_name: &str,
    backend: Option<String>,
    capabilities: Option<Value>,
    refs: StorageReferences,
    prefix: Option<&str>,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String(kind.to_string()));
    facts.insert(
        "variableName".to_string(),
        Value::String(variable_name.to_string()),
    );
    insert_string(&mut facts, "backend", backend);
    insert_value(&mut facts, "capabilities", capabilities);
    insert_string(&mut facts, "records", refs.records);
    insert_string(&mut facts, "vectors", refs.vectors);
    insert_string(&mut facts, "blobs", refs.blobs);
    insert_string(&mut facts, "storage", refs.storage);
    insert_string(&mut facts, "prefix", prefix.map(str::to_string));
    Value::Object(facts)
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

fn insert_value(metadata: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), value);
    }
}
