//! JSON-schema helpers for native expanded input-contract projection.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::contracts::input::EdgeFacts;
use crate::core::facts::StaticIndexDefinition;

pub(crate) fn contributions_from_schema(
    schema: Option<&Value>,
    source: &StaticIndexDefinition,
    path: &[String],
    edge: &EdgeFacts,
) -> Vec<Value> {
    let Some(properties) = schema.and_then(schema_properties) else {
        return Vec::new();
    };
    let required = schema
        .and_then(|schema| schema.get("required"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<BTreeSet<_>>();
    properties
        .iter()
        .map(|(field, field_schema)| {
            let mut contribution = Map::new();
            contribution.insert("field".to_string(), Value::String(field.clone()));
            contribution.insert("schema".to_string(), field_schema.clone());
            if let Some(description) = field_schema.get("description").and_then(Value::as_str) {
                contribution.insert(
                    "description".to_string(),
                    Value::String(description.to_string()),
                );
            }
            contribution.insert(
                "required".to_string(),
                Value::Bool(
                    required.contains(field.as_str())
                        && edge.conditionality.as_deref().unwrap_or("always") == "always",
                ),
            );
            contribution.insert(
                "sourceDefinitionId".to_string(),
                Value::String(source.id.clone()),
            );
            contribution.insert("sourceName".to_string(), Value::String(source.name.clone()));
            contribution.insert("sourceKind".to_string(), Value::String(source.kind.clone()));
            contribution.insert(
                "path".to_string(),
                Value::Array(path.iter().cloned().map(Value::String).collect()),
            );
            insert_optional_string(&mut contribution, "via", edge.via.clone());
            insert_optional_string(
                &mut contribution,
                "conditionality",
                edge.conditionality.clone(),
            );
            insert_optional_string(&mut contribution, "branch", edge.branch.clone());
            Value::Object(contribution)
        })
        .collect()
}

pub(crate) fn merge_object_schema_contributions(
    base: Option<&Value>,
    contributions: &[Value],
) -> Value {
    let mut expanded = base
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);
    let mut properties = expanded
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut required = expanded
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    for contribution in contributions {
        let Some(object) = contribution.as_object() else {
            continue;
        };
        let Some(field) = object.get("field").and_then(Value::as_str) else {
            continue;
        };
        if !properties.contains_key(field) {
            if let Some(schema) = object.get("schema") {
                properties.insert(field.to_string(), schema.clone());
            }
        }
        if object.get("required").and_then(Value::as_bool) == Some(true)
            && !required.iter().any(|item| item == field)
        {
            required.push(field.to_string());
        }
    }
    expanded.insert("type".to_string(), schema_type(base));
    expanded.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        expanded.insert(
            "required".to_string(),
            Value::Array(required.into_iter().map(Value::String).collect()),
        );
    }
    Value::Object(expanded)
}

pub(crate) fn own_input_schema(definition: &StaticIndexDefinition) -> Option<Value> {
    contract_input_schema(definition).or_else(|| metadata_input_schema(definition))
}

pub(crate) fn source_input_schema(definition: &StaticIndexDefinition) -> Option<Value> {
    contract_input_schema(definition).or_else(|| metadata_input_schema(definition))
}

pub(crate) fn clone_object_schema(schema: &Value) -> Option<Value> {
    let mut object = schema.as_object()?.clone();
    if let Some(properties) = schema_properties(schema) {
        object.insert("properties".to_string(), Value::Object(properties.clone()));
    }
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        object.insert("required".to_string(), Value::Array(required.clone()));
    }
    Some(Value::Object(object))
}

pub(crate) fn contribution_key(contribution: &Value) -> String {
    let field = contribution
        .get("field")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source = contribution
        .get("sourceDefinitionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = contribution
        .get("path")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(">");
    format!("{field}:{source}:{path}")
}

fn contract_input_schema(definition: &StaticIndexDefinition) -> Option<Value> {
    definition
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("intelligence"))
        .and_then(|intelligence| intelligence.get("contract"))
        .and_then(|contract| contract.get("inputSchema"))
        .cloned()
}

fn metadata_input_schema(definition: &StaticIndexDefinition) -> Option<Value> {
    definition
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("inputSchema"))
        .cloned()
}

fn schema_properties(schema: &Value) -> Option<&Map<String, Value>> {
    schema.get("properties").and_then(Value::as_object)
}

fn schema_type(base: Option<&Value>) -> Value {
    base.and_then(|schema| schema.get("type"))
        .cloned()
        .unwrap_or_else(|| Value::String("object".to_string()))
}

fn insert_optional_string(object: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        object.insert(key.to_string(), Value::String(value));
    }
}
