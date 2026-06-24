use serde_json::{Map, Value, json};

use crate::{
    extractors::context::PrimitiveContext,
    extractors::record_values::{property_value, reference_property, resolve_static_value},
    protocol::StaticSyntaxValue,
};

pub(crate) struct PipelineTarget {
    pub(crate) variable: String,
    pub(crate) property: &'static str,
}

pub(crate) fn pipeline_stage_target(
    context: &PrimitiveContext<'_>,
    stage: &StaticSyntaxValue,
) -> Option<PipelineTarget> {
    for property in ["agent", "flow", "prompt", "tool"] {
        if let Some(variable) = reference_property(stage, property, &context.initializers) {
            return Some(PipelineTarget { variable, property });
        }
    }
    None
}

pub(crate) fn identifier_array(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    property: &str,
) -> Vec<String> {
    let Some(value) = property_value(object, property) else {
        return Vec::new();
    };
    let resolved = resolve_static_value(value, &context.initializers, &mut Default::default());
    let StaticSyntaxValue::Array { elements } = resolved else {
        return Vec::new();
    };
    elements.iter().filter_map(reference_value).collect()
}

pub(crate) fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

pub(crate) fn insert_string_array(
    metadata: &mut Map<String, Value>,
    key: &str,
    values: Vec<String>,
) {
    if !values.is_empty() {
        metadata.insert(key.to_string(), json!(values));
    }
}

fn reference_value(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(name.clone()),
        StaticSyntaxValue::PropertyAccess { name, .. } => Some(name.clone()),
        _ => None,
    }
}
