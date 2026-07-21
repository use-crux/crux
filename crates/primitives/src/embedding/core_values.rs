use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::PrimitiveContext,
    protocol::StaticSyntaxValue,
    record_values::{direct_string_property, json_value, property_value, resolve_static_value},
};

const MODALITIES: &[&str] = &["text", "image", "audio", "video", "document"];

pub(crate) struct KnownTruncate {
    pub(crate) input: Option<Value>,
    pub(crate) fingerprint: Option<Value>,
}

pub(crate) struct KnownTaskValue {
    pub(crate) value: Value,
    pub(crate) exact: bool,
}

pub(crate) fn known_modalities(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<Option<Value>> {
    let Some(value) = property_value(config, "modalities") else {
        return Some(Some(json!(["text"])));
    };
    let value = json_value(value, &context.initializers)?;
    let Value::Array(values) = &value else {
        return None;
    };
    values
        .iter()
        .all(|item| item.as_str().is_some_and(|item| MODALITIES.contains(&item)))
        .then_some(Some(value))
}

pub(crate) fn known_normalization(
    config: &StaticSyntaxValue,
    embedding_kind: &str,
) -> Option<Option<String>> {
    if embedding_kind == "sparse" {
        return Some(None);
    }
    match direct_string_property(config, "normalization") {
        Some(value) if ["unit", "none", "unknown"].contains(&value.as_str()) => Some(Some(value)),
        Some(_) => None,
        None if property_value(config, "normalization").is_none() => {
            Some(Some("unknown".to_string()))
        }
        None => None,
    }
}

pub(crate) fn known_truncate(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<KnownTruncate> {
    let Some(value) = property_value(config, "truncate") else {
        let value = json!({ "strategy": "fail" });
        return Some(KnownTruncate {
            input: Some(value.clone()),
            fingerprint: Some(value),
        });
    };
    let value = json_value(value, &context.initializers)?;
    let strategy = value.get("strategy").and_then(Value::as_str);
    match strategy {
        None if value.as_object().is_some() => Some(KnownTruncate {
            input: Some(json!({ "strategy": "fail" })),
            fingerprint: Some(value),
        }),
        Some("fail") => {
            let normalized = json!({ "strategy": "fail" });
            Some(KnownTruncate {
                input: Some(normalized.clone()),
                fingerprint: Some(normalized),
            })
        }
        Some("chars") if value.get("maxChars").and_then(Value::as_f64).is_some() => {
            Some(KnownTruncate {
                input: Some(value.clone()),
                fingerprint: Some(value),
            })
        }
        _ => None,
    }
}

pub(crate) fn optional_string(
    config: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<String>> {
    match direct_string_property(config, property) {
        Some(value) => Some(Some(value)),
        None if property_value(config, property).is_none() => Some(None),
        None => None,
    }
}

pub(crate) fn known_tasks(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<Option<KnownTaskValue>> {
    let Some(value) = property_value(config, "tasks") else {
        return Some(None);
    };
    known_task_value(value, context).map(Some)
}

pub(crate) fn known_task_value(
    value: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<KnownTaskValue> {
    let value = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    let StaticSyntaxValue::Object { properties, .. } = value else {
        return None;
    };
    let exact = properties.iter().all(|property| {
        property.spread != Some(true) && matches!(property.name.as_str(), "query" | "document")
    });
    let mut tasks = Map::new();
    for property in ["query", "document"] {
        if property_value(value, property).is_none() {
            continue;
        }
        tasks.insert(
            property.to_string(),
            Value::String(direct_string_property(value, property)?),
        );
    }
    Some(KnownTaskValue {
        value: Value::Object(tasks),
        exact,
    })
}

pub(crate) fn known_preprocessor_count(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<usize> {
    let Some(value) = property_value(config, "preprocess") else {
        return Some(0);
    };
    match json_value(value, &context.initializers) {
        Some(Value::Array(values)) => Some(values.len()),
        Some(_) => Some(1),
        None => None,
    }
}
