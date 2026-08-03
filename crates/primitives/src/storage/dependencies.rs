use serde_json::{Map, Value, json};

use crate::{
    protocol::{StaticInitializerRecord, StaticSyntaxValue},
    record_values::{property_value, resolve_static_value},
};

#[derive(Clone, Default)]
pub(crate) struct StorageReferences {
    pub storage: Option<StorageReference>,
    pub records: Option<StorageReference>,
    pub search: Option<StorageReference>,
    pub assets: Option<StorageReference>,
}

#[derive(Clone)]
pub(crate) struct StorageReference {
    pub name: String,
    pub(crate) bindable: bool,
}

pub(crate) fn storage_config_references(
    config: Option<&StaticSyntaxValue>,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> StorageReferences {
    let Some(config) = config else {
        return StorageReferences::default();
    };
    StorageReferences {
        storage: storage_reference_property(config, "storage", initializers),
        records: storage_reference_property(config, "records", initializers),
        search: storage_reference_property(config, "search", initializers),
        assets: storage_reference_property(config, "assets", initializers),
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
        refs.storage.as_ref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_record_store"),
        refs.records.as_ref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_search_store"),
        refs.search.as_ref(),
    );
    push_relation(
        &mut references,
        format!("{owner}.uses_asset_store"),
        refs.assets.as_ref(),
    );
    references
}

pub(crate) fn has_storage_references(refs: &StorageReferences) -> bool {
    refs.storage.is_some()
        || refs.records.is_some()
        || refs.search.is_some()
        || refs.assets.is_some()
}

pub(crate) fn storage_dependency_map(refs: &StorageReferences) -> Map<String, Value> {
    let mut dependencies = Map::new();
    insert_dependency(&mut dependencies, "storage", refs.storage.as_ref());
    insert_dependency(&mut dependencies, "recordStores", refs.records.as_ref());
    insert_dependency(&mut dependencies, "searchStores", refs.search.as_ref());
    insert_dependency(&mut dependencies, "assetStores", refs.assets.as_ref());
    dependencies
}

fn insert_dependency(
    dependencies: &mut Map<String, Value>,
    key: &str,
    value: Option<&StorageReference>,
) {
    if let Some(value) = value {
        dependencies.insert(key.to_string(), json!([value.name]));
    }
}

fn push_relation(
    references: &mut Vec<Value>,
    relation_type: String,
    reference: Option<&StorageReference>,
) {
    if let Some(reference) = reference {
        if reference.bindable {
            references.push(json!({ "type": relation_type, "toVariable": reference.name }));
        } else if let Some(fallback_to_id) = storage_fallback_id(&relation_type, &reference.name) {
            references.push(json!({ "type": relation_type, "fallbackToId": fallback_to_id }));
        }
    }
}

fn storage_reference_property(
    object: &StaticSyntaxValue,
    name: &str,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Option<StorageReference> {
    storage_reference_name(property_value(object, name)).or_else(|| {
        storage_reference_name(Some(resolve_static_value(
            property_value(object, name)?,
            initializers,
            &mut std::collections::HashSet::new(),
        )))
    })
}

fn storage_reference_name(value: Option<&StaticSyntaxValue>) -> Option<StorageReference> {
    match value {
        Some(StaticSyntaxValue::Identifier { name }) => Some(StorageReference {
            name: name.clone(),
            bindable: true,
        }),
        Some(StaticSyntaxValue::PropertyAccess { name, .. }) => Some(StorageReference {
            name: name.clone(),
            bindable: false,
        }),
        Some(StaticSyntaxValue::Call { callee, .. }) => Some(StorageReference {
            name: callee
                .local_name
                .clone()
                .unwrap_or_else(|| callee.name.clone()),
            bindable: false,
        }),
        _ => None,
    }
}

fn storage_fallback_id(relation_type: &str, name: &str) -> Option<String> {
    match relation_type {
        "storage.bundle.uses_record_store"
        | "rag.retriever.uses_record_store"
        | "workspace.uses_record_store" => {
            Some(format!("storage.recordStore:{}", safe_reference_id(name)))
        }
        "storage.bundle.uses_search_store"
        | "rag.retriever.uses_search_store"
        | "workspace.uses_search_store" => {
            Some(format!("storage.searchStore:{}", safe_reference_id(name)))
        }
        "storage.bundle.uses_asset_store"
        | "rag.retriever.uses_asset_store"
        | "workspace.uses_asset_store" => {
            Some(format!("storage.assetStore:{}", safe_reference_id(name)))
        }
        "storage.scope.wraps_storage" | "rag.retriever.uses_storage" | "workspace.uses_storage" => {
            Some(format!("storage.bundle:{}", safe_reference_id(name)))
        }
        _ => None,
    }
}

fn safe_reference_id(value: &str) -> String {
    let mut output = String::new();
    let mut previous_was_lower_or_digit = false;
    for character in value.chars() {
        if character.is_ascii_uppercase() && previous_was_lower_or_digit {
            output.push('-');
        }
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            output.push(character.to_ascii_lowercase());
            previous_was_lower_or_digit =
                character.is_ascii_lowercase() || character.is_ascii_digit();
        } else {
            output.push('-');
            previous_was_lower_or_digit = false;
        }
    }
    output.trim_matches('-').to_string()
}
