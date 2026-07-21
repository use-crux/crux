use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub(crate) fn insert(target: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        target.insert(key.to_string(), value);
    }
}

pub(crate) fn number(value: f64) -> Value {
    Value::Number(serde_json::Number::from_f64(value).expect("finite static number"))
}

pub(crate) fn sorted_string_array(value: Value) -> Value {
    let Value::Array(mut values) = value else {
        return value;
    };
    values.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
    Value::Array(values)
}

pub(crate) fn provider_fingerprint(inputs: &Map<String, Value>) -> String {
    let mut value = Map::new();
    for key in [
        "dimensions",
        "maxInputTokens",
        "modalities",
        "name",
        "normalization",
        "tasks",
        "truncate",
        "version",
    ] {
        if let Some(item) = inputs.get(key) {
            value.insert(key.to_string(), item.clone());
        }
    }
    if let Some(Value::Array(modalities)) = value.get_mut("modalities") {
        modalities.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
    }
    value.insert("kind".to_string(), Value::String("dense".to_string()));
    value.insert("preprocessors".to_string(), Value::Array(Vec::new()));
    stable_json(&Value::Object(value))
}

pub(crate) fn stable_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => {
            serde_json::to_string(value).expect("JSON values serialize")
        }
        Value::Number(number) => number
            .as_f64()
            .filter(|value| value.fract() == 0.0)
            .map(|value| format!("{value:.0}"))
            .unwrap_or_else(|| number.to_string()),
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(stable_json).collect::<Vec<_>>().join(",")
        ),
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("JSON keys serialize"),
                        stable_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
