use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    protocol::{LiteralValue, StaticInitializerRecord, StaticSyntaxValue},
    record_values::{property_value, resolve_static_value},
};

/// Extract compact, literal-only facts used by the Project Index catalog.
///
/// Dynamic values are intentionally omitted. The catalog should show what the
/// static extractor can prove, not guesses from partially resolved authoring
/// code.
pub(crate) fn evaluation_catalog_facts(
    config: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Map<String, Value> {
    let mut facts = Map::new();
    insert_non_empty_array(
        &mut facts,
        "datasetPaths",
        dataset_paths(config, initializers),
    );
    insert_non_empty_array(
        &mut facts,
        "scorerNames",
        scorer_names(config, initializers),
    );
    insert_non_empty_array(&mut facts, "gateKeys", gate_keys(config, initializers));
    insert_non_empty_array(
        &mut facts,
        "variantNames",
        variant_names(config, initializers),
    );
    if let Some(trials) = number_property(config, "trials", initializers) {
        facts.insert("trials".to_string(), json!(trials));
    }
    if let Some(replay) = string_property(config, "replay", initializers) {
        facts.insert("replayMode".to_string(), Value::String(replay));
    }
    facts
}

fn dataset_paths(
    config: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Vec<String> {
    let Some(value) = property_value(config, "data") else {
        return Vec::new();
    };
    let resolved = resolve_static_value(value, initializers, &mut HashSet::new());
    dataset_path_from_value(resolved).into_iter().collect()
}

fn dataset_path_from_value(value: &StaticSyntaxValue) -> Option<String> {
    let StaticSyntaxValue::Call { callee, args, .. } = value else {
        return None;
    };
    if callee.name != "dataset" {
        return None;
    }
    args.first().and_then(string_value)
}

fn scorer_names(
    config: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Vec<String> {
    let Some(value) = property_value(config, "scorers") else {
        return Vec::new();
    };
    let StaticSyntaxValue::Array { elements } =
        resolve_static_value(value, initializers, &mut HashSet::new())
    else {
        return Vec::new();
    };
    elements
        .iter()
        .filter_map(|element| scorer_name(element, initializers))
        .collect()
}

fn scorer_name(
    value: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Option<String> {
    match resolve_static_value(value, initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Object { .. } => string_property(value, "scorerName", initializers),
        StaticSyntaxValue::Call { callee, args, .. } => args
            .first()
            .and_then(|arg| string_property(arg, "name", initializers))
            .or_else(|| Some(callee.name.clone())),
        _ => None,
    }
}

fn gate_keys(
    config: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Vec<String> {
    let Some(gates) = property_value(config, "gates") else {
        return Vec::new();
    };
    let StaticSyntaxValue::Object { properties, .. } =
        resolve_static_value(gates, initializers, &mut HashSet::new())
    else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    for property in properties
        .iter()
        .filter(|property| property.spread != Some(true))
    {
        if property.name == "scores" {
            if let StaticSyntaxValue::Object { properties, .. } =
                resolve_static_value(&property.value, initializers, &mut HashSet::new())
            {
                keys.extend(
                    properties
                        .iter()
                        .filter(|property| property.spread != Some(true))
                        .map(|property| property.name.clone()),
                );
            }
        } else {
            keys.push(property.name.clone());
        }
    }
    keys
}

fn variant_names(
    config: &StaticSyntaxValue,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Vec<String> {
    let Some(variants) = property_value(config, "variants") else {
        return Vec::new();
    };
    let StaticSyntaxValue::Object { properties, .. } =
        resolve_static_value(variants, initializers, &mut HashSet::new())
    else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|property| property.spread != Some(true))
        .map(|property| property.name.clone())
        .collect()
}

fn string_property(
    object: &StaticSyntaxValue,
    property: &str,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Option<String> {
    property_value(object, property)
        .map(|value| resolve_static_value(value, initializers, &mut HashSet::new()))
        .and_then(string_value)
}

fn number_property(
    object: &StaticSyntaxValue,
    property: &str,
    initializers: &std::collections::HashMap<&str, &StaticInitializerRecord>,
) -> Option<u64> {
    let value = property_value(object, property)?;
    match resolve_static_value(value, initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::Number(value),
        } if value.fract() == 0.0 && *value >= 0.0 => Some(*value as u64),
        _ => None,
    }
}

fn string_value(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn insert_non_empty_array(map: &mut Map<String, Value>, key: &str, values: Vec<String>) {
    if !values.is_empty() {
        map.insert(key.to_string(), json!(values));
    }
}
