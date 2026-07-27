use std::collections::{HashMap, HashSet};

use serde_json::{Map, Number, Value};

use crate::{
    protocol::{LiteralValue, StaticInitializerRecord, StaticSyntaxValue},
    record_values::{has_property, property_value, resolve_static_value},
};

const ACTIONS: &[&str] = &["block", "strip", "warn"];
const MODALITIES: &[&str] = &["audio", "file", "image", "video"];
const UNSUPPORTED_ACTIONS: &[&str] = &["allow", "block", "strip", "warn"];

/// Returns whether projected strategy facts require source-snippet omission.
pub(super) fn is_media_classifier_strategy(strategy: &Value) -> bool {
    strategy.get("kind").and_then(Value::as_str) == Some("mediaClassifier")
}

/// Projects the explicit privacy-safe subset of one media-classifier config.
pub(super) fn media_classifier_config_value(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    let config = resolve_static_value(value, initializers, &mut HashSet::new());
    let StaticSyntaxValue::Object { properties, .. } = config else {
        return None;
    };
    if properties
        .iter()
        .any(|property| property.spread == Some(true))
    {
        return None;
    }

    let mut projected = Map::new();
    projected.insert(
        "categoryIds".to_string(),
        Value::Array(category_ids(config, initializers)?),
    );
    projected.insert(
        "threshold".to_string(),
        finite_number(property_value(config, "threshold")?, initializers)?,
    );
    insert_optional_object(
        &mut projected,
        config,
        "thresholds",
        initializers,
        literal_number_map,
    )?;
    insert_optional_string(&mut projected, config, "action", initializers, ACTIONS)?;
    insert_optional_array(
        &mut projected,
        config,
        "modalities",
        initializers,
        MODALITIES,
    )?;
    insert_optional_string(
        &mut projected,
        config,
        "unsupported",
        initializers,
        UNSUPPORTED_ACTIONS,
    )?;
    Some(Value::Object(projected))
}

fn category_ids(
    config: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Vec<Value>> {
    let categories = resolve_static_value(
        property_value(config, "categories")?,
        initializers,
        &mut HashSet::new(),
    );
    let StaticSyntaxValue::Array { elements } = categories else {
        return None;
    };
    if elements.is_empty() {
        return None;
    }
    elements
        .iter()
        .map(|category| {
            let category = resolve_static_value(category, initializers, &mut HashSet::new());
            let StaticSyntaxValue::Object { properties, .. } = category else {
                return None;
            };
            if properties
                .iter()
                .any(|property| property.spread == Some(true))
            {
                return None;
            }
            literal_string(property_value(category, "id")?, initializers).map(Value::String)
        })
        .collect()
}

fn literal_number_map(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    let value = resolve_static_value(value, initializers, &mut HashSet::new());
    let StaticSyntaxValue::Object { properties, .. } = value else {
        return None;
    };
    if properties
        .iter()
        .any(|property| property.spread == Some(true))
    {
        return None;
    }
    properties
        .iter()
        .map(|property| {
            finite_number(&property.value, initializers).map(|value| (property.name.clone(), value))
        })
        .collect::<Option<Map<_, _>>>()
        .map(Value::Object)
}

fn finite_number(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    match resolve_static_value(value, initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::Number(value),
        } => Number::from_f64(*value).map(Value::Number),
        _ => None,
    }
}

fn literal_string(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<String> {
    match resolve_static_value(value, initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn literal_string_array(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
    allowed: &[&str],
) -> Option<Value> {
    let value = resolve_static_value(value, initializers, &mut HashSet::new());
    let StaticSyntaxValue::Array { elements } = value else {
        return None;
    };
    let values = elements
        .iter()
        .map(|value| literal_string(value, initializers))
        .collect::<Option<Vec<_>>>()?;
    values
        .iter()
        .all(|value| allowed.contains(&value.as_str()))
        .then(|| Value::Array(values.into_iter().map(Value::String).collect()))
}

fn insert_optional_string(
    projected: &mut Map<String, Value>,
    config: &StaticSyntaxValue,
    property: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
    allowed: &[&str],
) -> Option<()> {
    if !has_property(config, property) {
        return Some(());
    }
    let value = literal_string(property_value(config, property)?, initializers)?;
    if !allowed.contains(&value.as_str()) {
        return None;
    }
    projected.insert(property.to_string(), Value::String(value));
    Some(())
}

fn insert_optional_array(
    projected: &mut Map<String, Value>,
    config: &StaticSyntaxValue,
    property: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
    allowed: &[&str],
) -> Option<()> {
    if !has_property(config, property) {
        return Some(());
    }
    let value = literal_string_array(property_value(config, property)?, initializers, allowed)?;
    projected.insert(property.to_string(), value);
    Some(())
}

fn insert_optional_object(
    projected: &mut Map<String, Value>,
    config: &StaticSyntaxValue,
    property: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
    project: fn(&StaticSyntaxValue, &HashMap<&str, &StaticInitializerRecord>) -> Option<Value>,
) -> Option<()> {
    if !has_property(config, property) {
        return Some(());
    }
    projected.insert(
        property.to_string(),
        project(property_value(config, property)?, initializers)?,
    );
    Some(())
}
