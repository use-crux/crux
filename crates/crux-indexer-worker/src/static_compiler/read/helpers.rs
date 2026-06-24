//! Shared helpers for relation-derived definition metadata.

use serde_json::{Map, Value};

use crate::static_compiler::core::facts::{NativeStaticDefinition, NativeStaticFidelity};

pub(crate) fn definition_metadata(definition: &NativeStaticDefinition) -> Map<String, Value> {
    definition
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

pub(crate) fn object_entry<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value
        .as_object_mut()
        .expect("object entry should be an object")
}

pub(crate) fn definition_export_name(definition: &NativeStaticDefinition) -> Option<String> {
    definition
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("exportName"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn fidelity_json_name(fidelity: NativeStaticFidelity) -> &'static str {
    match fidelity {
        NativeStaticFidelity::Resolved => "resolved",
        NativeStaticFidelity::Partial => "partial",
        NativeStaticFidelity::Error => "error",
    }
}
