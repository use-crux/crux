//! Schema and contract predicates for native built-in graph lints.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::facts::{StaticIndexDefinition, StaticIndexProjectSourceRef, StaticIndexRelation};
use crate::helpers::{has_items, is_record, metadata_path, metadata_value};

pub(crate) fn has_input_schema(definition: &StaticIndexDefinition) -> bool {
    is_record(metadata_value(definition, "inputSchema"))
        || is_record(metadata_value(definition, "parameters"))
        || is_record(metadata_value(definition, "schema"))
        || is_record(metadata_path(
            definition,
            &["intelligence", "contract", "inputSchema"],
        ))
}

pub(crate) fn has_output_schema(definition: &StaticIndexDefinition) -> bool {
    is_record(metadata_value(definition, "outputSchema"))
        || is_record(metadata_path(
            definition,
            &["intelligence", "contract", "outputSchema"],
        ))
}

pub(crate) fn has_args_schema(definition: &StaticIndexDefinition) -> bool {
    is_record(metadata_value(definition, "argsSchema"))
        || is_record(metadata_path(
            definition,
            &["intelligence", "contract", "argsSchema"],
        ))
}

pub(crate) fn context_requires_input_schema(definition: &StaticIndexDefinition) -> bool {
    let Some(metadata) = definition.metadata.as_ref() else {
        return false;
    };
    metadata.get("isStatic").and_then(Value::as_bool) == Some(false)
        || !schema_source_refs(definition, "input").is_empty()
}

pub(crate) fn flow_requires_args_schema(definition: &StaticIndexDefinition) -> bool {
    metadata_value(definition, "hasArgs").and_then(Value::as_bool) == Some(true)
        || has_items(metadata_value(definition, "args"))
}

pub(crate) fn tool_output_needs_adapter(definition: &StaticIndexDefinition) -> bool {
    metadata_value(definition, "hasExecute").and_then(Value::as_bool) == Some(true)
        && metadata_value(definition, "hasToModelOutput").and_then(Value::as_bool) != Some(true)
}

pub(crate) fn has_suspension_points(definition: &StaticIndexDefinition) -> bool {
    metadata_path(definition, &["intelligence", "control", "suspensionPoints"])
        .and_then(Value::as_array)
        .is_some_and(|points| !points.is_empty())
}

pub(crate) fn suspension_point_labels(definition: &StaticIndexDefinition) -> Vec<String> {
    metadata_path(definition, &["intelligence", "control", "suspensionPoints"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|point| point.get("label").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

pub(crate) fn flow_step_labels(definition: &StaticIndexDefinition) -> Vec<String> {
    metadata_path(definition, &["intelligence", "control", "steps"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|step| step.get("label").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

pub(crate) fn declared_signal_names(
    definition: &StaticIndexDefinition,
) -> Option<BTreeSet<String>> {
    metadata_value(definition, "signalNames")
        .and_then(Value::as_array)
        .map(|signals| {
            signals
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
}

pub(crate) fn schema_source_evidence(
    definition: &StaticIndexDefinition,
    property: &str,
    label: &str,
) -> Vec<Value> {
    schema_source_refs(definition, property)
        .into_iter()
        .map(|source_ref| {
            json!({
                "kind": "source",
                "label": label,
                "source": source_ref.source,
                "data": {
                    "role": source_ref.role,
                    "property": source_ref.property,
                    "symbol": source_ref.symbol,
                    "fidelity": source_ref.fidelity,
                    "parsedSchema": source_ref.metadata.as_ref().and_then(|metadata| metadata.get("parsedSchema")).cloned(),
                    "schemaKind": source_ref.metadata.as_ref().and_then(|metadata| metadata.get("schemaKind")).cloned(),
                    "definitionId": definition.id,
                },
            })
        })
        .collect()
}

pub(crate) fn schema_source_refs<'a>(
    definition: &'a StaticIndexDefinition,
    property: &str,
) -> Vec<&'a StaticIndexProjectSourceRef> {
    definition
        .source_refs
        .iter()
        .filter(|source_ref| {
            source_ref.role == "schema" && source_ref.property.as_deref() == Some(property)
        })
        .collect()
}

pub(crate) fn contract_input_schema(definition: &StaticIndexDefinition) -> Option<&Value> {
    metadata_path(definition, &["intelligence", "contract", "inputSchema"])
        .filter(|value| is_record(Some(*value)))
        .or_else(|| {
            metadata_value(definition, "inputSchema").filter(|value| is_record(Some(*value)))
        })
}

pub(crate) fn contract_expanded_input_schema(definition: &StaticIndexDefinition) -> Option<&Value> {
    metadata_path(
        definition,
        &["intelligence", "contract", "expandedInputSchema"],
    )
    .filter(|value| is_record(Some(*value)))
}

pub(crate) fn contract_input_contributions(definition: &StaticIndexDefinition) -> Vec<Value> {
    metadata_path(
        definition,
        &["intelligence", "contract", "inputContributions"],
    )
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
}

pub(crate) fn schema_required_fields(schema: Option<&Value>) -> BTreeSet<String> {
    schema
        .and_then(|schema| schema.get("required"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

pub(crate) fn contribution_source_requires_field(
    contribution: &Value,
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> bool {
    let Some(field) = contribution.get("field").and_then(Value::as_str) else {
        return false;
    };
    let Some(source_id) = contribution
        .get("sourceDefinitionId")
        .and_then(Value::as_str)
    else {
        return contribution.get("required").and_then(Value::as_bool) == Some(true);
    };
    by_id
        .get(source_id)
        .is_some_and(|source| schema_required_fields(contract_input_schema(source)).contains(field))
}

pub(crate) fn schema_conflict_reason(left: &Value, right: &Value) -> Option<String> {
    let left_type = schema_type(left);
    let right_type = schema_type(right);
    if let (Some(left_type), Some(right_type)) = (left_type, right_type) {
        if left_type != right_type {
            return Some(format!("{left_type} vs {right_type}"));
        }
    }
    if let (Some(left_const), Some(right_const)) = (left.get("const"), right.get("const")) {
        if left_const != right_const {
            return Some("different const values".to_string());
        }
    }
    let left_enum = string_enum_values(left);
    let right_enum = string_enum_values(right);
    if let (Some(left_enum), Some(right_enum)) = (left_enum, right_enum) {
        if left_enum != right_enum {
            return Some("different enum values".to_string());
        }
    }
    None
}

pub(crate) fn is_conditional_contribution(contribution: &Value) -> bool {
    contribution
        .get("conditionality")
        .and_then(Value::as_str)
        .is_some_and(|value| value != "always" && value != "unknown")
}

pub(crate) fn is_state_resource_read_relation(relation: &StaticIndexRelation) -> bool {
    relation.r#type.ends_with(".reads_memory")
        || relation.r#type.ends_with(".reads_blackboard")
        || relation.r#type.ends_with(".reads_workspace")
}

pub(crate) fn is_state_resource_write_relation(relation: &StaticIndexRelation) -> bool {
    relation.r#type.ends_with(".writes_memory")
        || relation.r#type.ends_with(".writes_blackboard")
        || relation.r#type.ends_with(".writes_workspace")
}

fn schema_type(schema: &Value) -> Option<String> {
    match schema.get("type") {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Array(values)) => {
            let mut values = values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>();
            values.sort();
            (!values.is_empty()).then(|| values.join("|"))
        }
        _ if schema
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| !properties.is_empty()) =>
        {
            Some("object".to_string())
        }
        _ if schema.get("items").is_some() => Some("array".to_string()),
        _ => None,
    }
}

fn string_enum_values(schema: &Value) -> Option<Vec<String>> {
    let values = schema.get("enum")?.as_array()?;
    let strings = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if strings.len() != values.len() {
        return None;
    }
    let mut strings = strings;
    strings.sort();
    Some(strings)
}
