use serde_json::{Map, Value, json};

use crate::{
    protocol::{StaticInitializerRecord, StaticSyntaxValue},
    record_values::reference_property,
};

#[derive(Clone, Default)]
pub(crate) struct StorageReferences {
    pub storage: Option<String>,
    pub records: Option<String>,
    pub vectors: Option<String>,
    pub blobs: Option<String>,
}

pub(crate) fn storage_config_references(
    config: Option<&StaticSyntaxValue>,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> StorageReferences {
    let Some(config) = config else {
        return StorageReferences::default();
    };
    StorageReferences {
        storage: reference_property(config, "storage", initializers),
        records: reference_property(config, "records", initializers),
        vectors: reference_property(config, "vectors", initializers),
        blobs: reference_property(config, "blobs", initializers),
    }
}

pub(crate) fn storage_dependency_metadata(refs: &StorageReferences) -> Option<Value> {
    if !has_storage_references(refs) {
        return None;
    }
    Some(Value::Object(storage_dependency_map(refs)))
}

pub(crate) fn storage_relation_refs(owner: &str, refs: &StorageReferences) -> Vec<Value> {
    let mut references = Vec::new();
    push_relation(
        &mut references,
        format!("{owner}.uses_storage"),
        refs.storage.as_deref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_record_store"),
        refs.records.as_deref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_vector_store"),
        refs.vectors.as_deref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_blob_store"),
        refs.blobs.as_deref(),
    );
    references
}

pub(crate) fn has_storage_references(refs: &StorageReferences) -> bool {
    refs.storage.is_some()
        || refs.records.is_some()
        || refs.vectors.is_some()
        || refs.blobs.is_some()
}

pub(crate) fn storage_dependency_map(refs: &StorageReferences) -> Map<String, Value> {
    let mut dependencies = Map::new();
    insert_dependency(&mut dependencies, "storage", refs.storage.as_deref());
    insert_dependency(&mut dependencies, "recordStores", refs.records.as_deref());
    insert_dependency(&mut dependencies, "vectorStores", refs.vectors.as_deref());
    insert_dependency(&mut dependencies, "blobStores", refs.blobs.as_deref());
    dependencies
}

fn insert_dependency(dependencies: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        dependencies.insert(key.to_string(), json!([value]));
    }
}

fn push_relation(references: &mut Vec<Value>, relation_type: String, to_variable: Option<&str>) {
    if let Some(to_variable) = to_variable {
        references.push(json!({ "type": relation_type, "toVariable": to_variable }));
    }
}
