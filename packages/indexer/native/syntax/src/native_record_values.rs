use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::protocol::{
    LiteralValue, SourceLocation, SourceSnippet, StaticInitializerRecord, StaticObjectProperty,
    StaticSyntaxValue,
};

pub(crate) fn object_value(value: &StaticSyntaxValue) -> Option<&StaticSyntaxValue> {
    matches!(value, StaticSyntaxValue::Object { .. }).then_some(value)
}

pub(crate) fn property_value<'a>(
    object: &'a StaticSyntaxValue,
    name: &str,
) -> Option<&'a StaticSyntaxValue> {
    object_property(object, name).map(|property| &property.value)
}

pub(crate) fn object_property<'a>(
    object: &'a StaticSyntaxValue,
    name: &str,
) -> Option<&'a StaticObjectProperty> {
    match object {
        StaticSyntaxValue::Object { properties, .. } => properties
            .iter()
            .find(|property| property.spread != Some(true) && property.name == name),
        _ => None,
    }
}

pub(crate) fn has_property(object: &StaticSyntaxValue, name: &str) -> bool {
    object_property(object, name).is_some()
}

pub(crate) fn direct_string_property(object: &StaticSyntaxValue, name: &str) -> Option<String> {
    match property_value(object, name) {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}

pub(crate) fn number_property(
    object: &StaticSyntaxValue,
    name: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<f64> {
    match property_value(object, name)
        .map(|value| resolve_static_value(value, initializers, &mut HashSet::new()))
    {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Number(value),
        }) => Some(*value),
        _ => None,
    }
}

pub(crate) fn reference_property(
    object: &StaticSyntaxValue,
    name: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<String> {
    reference_name(property_value(object, name)).or_else(|| {
        reference_name(Some(resolve_static_value(
            property_value(object, name)?,
            initializers,
            &mut HashSet::new(),
        )))
    })
}

pub(crate) fn direct_identifier(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(name.clone()),
        _ => None,
    }
}

pub(crate) fn object_map_identifier_entries(
    value: Option<&StaticSyntaxValue>,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Vec<(String, String)> {
    let resolved =
        value.map(|value| resolve_static_value(value, initializers, &mut HashSet::new()));
    let Some(StaticSyntaxValue::Object { properties, .. }) = resolved else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .filter_map(|property| {
            direct_identifier(&property.value).map(|value| (property.name.clone(), value))
        })
        .collect()
}

pub(crate) fn object_array_value<'a>(
    value: Option<&'a StaticSyntaxValue>,
    initializers: &HashMap<&str, &'a StaticInitializerRecord>,
) -> Vec<&'a StaticSyntaxValue> {
    let Some(StaticSyntaxValue::Array { elements }) =
        value.map(|value| resolve_static_value(value, initializers, &mut HashSet::new()))
    else {
        return Vec::new();
    };
    elements
        .iter()
        .filter_map(|element| {
            let resolved = resolve_static_value(element, initializers, &mut HashSet::new());
            matches!(resolved, StaticSyntaxValue::Object { .. }).then_some(resolved)
        })
        .collect()
}

pub(crate) fn fallback_options(args: &[StaticSyntaxValue]) -> Vec<&StaticSyntaxValue> {
    args.iter()
        .enumerate()
        .filter_map(|(index, value)| {
            (!is_fallback_options_argument(value, index, args.len())).then_some(value)
        })
        .collect()
}

pub(crate) fn fallback_model_preview(value: &StaticSyntaxValue) -> Option<Value> {
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(text),
        } if !text.is_empty() => Some(Value::String(text.clone())),
        StaticSyntaxValue::Object { properties, .. } => Some(Value::Object(
            properties
                .iter()
                .filter(|property| property.spread != Some(true))
                .filter_map(|property| {
                    literal_json(&property.value).map(|value| (property.name.clone(), value))
                })
                .collect(),
        )),
        _ => None,
    }
}

pub(crate) fn json_object_property(
    object: &StaticSyntaxValue,
    property: Option<&str>,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Option<Value>> {
    let value = property.map_or(Some(object), |property| property_value(object, property));
    let json = json_value(value?, initializers)?;
    Some(json.is_object().then_some(json))
}

pub(crate) fn resolve_static_value<'a>(
    value: &'a StaticSyntaxValue,
    initializers: &HashMap<&str, &'a StaticInitializerRecord>,
    seen: &mut HashSet<String>,
) -> &'a StaticSyntaxValue {
    match value {
        StaticSyntaxValue::Identifier { name } if seen.insert(name.clone()) => initializers
            .get(name.as_str())
            .map(|initializer| resolve_static_value(&initializer.value, initializers, seen))
            .unwrap_or(value),
        _ => value,
    }
}

pub(crate) fn source_for_value(
    value: &StaticSyntaxValue,
    property: &StaticObjectProperty,
) -> SourceLocation {
    match value {
        StaticSyntaxValue::Object { source, .. }
        | StaticSyntaxValue::Call { source, .. }
        | StaticSyntaxValue::Function { source, .. }
        | StaticSyntaxValue::Unsupported { source, .. } => source.clone(),
        _ => property.source.clone(),
    }
}

pub(crate) fn snippet_for_value(
    value: &StaticSyntaxValue,
    initializer: Option<&StaticInitializerRecord>,
) -> Option<SourceSnippet> {
    match value {
        StaticSyntaxValue::Object { snippet, .. }
        | StaticSyntaxValue::Call { snippet, .. }
        | StaticSyntaxValue::Function { snippet, .. } => snippet
            .clone()
            .or_else(|| initializer.and_then(|item| item.snippet.clone())),
        _ => initializer.and_then(|item| item.snippet.clone()),
    }
}

pub(crate) fn function_name_for_value(
    value: &StaticSyntaxValue,
    symbol: Option<&str>,
) -> Option<String> {
    matches!(value, StaticSyntaxValue::Function { .. })
        .then(|| symbol.unwrap_or_default().to_string())
}

fn reference_name(value: Option<&StaticSyntaxValue>) -> Option<String> {
    match value {
        Some(StaticSyntaxValue::Identifier { name }) => Some(name.clone()),
        Some(StaticSyntaxValue::PropertyAccess { name, .. }) => Some(name.clone()),
        _ => None,
    }
}

fn is_fallback_options_argument(value: &StaticSyntaxValue, index: usize, arg_count: usize) -> bool {
    index == arg_count.saturating_sub(1)
        && matches!(value, StaticSyntaxValue::Object { .. })
        && [
            "id",
            "description",
            "timeout",
            "timeoutMs",
            "on",
            "shouldFallback",
            "onAttemptError",
        ]
        .iter()
        .any(|property| property_value(value, property).is_some())
}

fn json_value(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    match resolve_static_value(value, initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal { value } => literal_json_value(value),
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .map(|element| json_value(element, initializers))
            .collect::<Option<Vec<_>>>()
            .map(Value::Array),
        StaticSyntaxValue::Object { properties, .. } => properties
            .iter()
            .filter(|property| property.spread != Some(true))
            .map(|property| {
                json_value(&property.value, initializers)
                    .map(|value| (property.name.clone(), value))
            })
            .collect::<Option<Map<_, _>>>()
            .map(Value::Object),
        _ => None,
    }
}

fn literal_json(value: &StaticSyntaxValue) -> Option<Value> {
    match value {
        StaticSyntaxValue::Literal { value } => literal_json_value(value),
        _ => None,
    }
}

fn literal_json_value(value: &LiteralValue) -> Option<Value> {
    match value {
        LiteralValue::String(value) => Some(Value::String(value.clone())),
        LiteralValue::Number(value) => Some(json!(value)),
        LiteralValue::Boolean(value) => Some(Value::Bool(*value)),
        LiteralValue::Null => Some(Value::Null),
    }
}
