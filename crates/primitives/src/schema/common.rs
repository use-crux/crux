use serde_json::{Map, Value, json};

use crate::protocol::{LiteralValue, StaticSyntaxValue};

pub(crate) fn object_schema(properties: Map<String, Value>, required: Vec<Value>) -> Value {
    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), Value::Array(required));
    }
    schema.insert("additionalProperties".to_string(), Value::Bool(false));
    Value::Object(schema)
}

pub(crate) fn contains_root_namespace(value: &StaticSyntaxValue, namespace: &str) -> bool {
    match value {
        StaticSyntaxValue::Identifier { name } => name == namespace,
        StaticSyntaxValue::PropertyAccess { path, .. } => {
            path.first().is_some_and(|root| root == namespace)
        }
        StaticSyntaxValue::Call { receiver, args, .. } => {
            receiver
                .as_ref()
                .is_some_and(|receiver| contains_root_namespace(receiver, namespace))
                || args
                    .iter()
                    .any(|arg| contains_root_namespace(arg, namespace))
        }
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .any(|element| contains_root_namespace(element, namespace)),
        StaticSyntaxValue::Object { properties, .. } => properties
            .iter()
            .filter(|property| property.spread != Some(true))
            .any(|property| contains_root_namespace(&property.value, namespace)),
        _ => false,
    }
}

pub(crate) fn is_root_namespace(value: Option<&StaticSyntaxValue>, namespace: &str) -> bool {
    match value {
        Some(StaticSyntaxValue::Identifier { name }) => name == namespace,
        Some(StaticSyntaxValue::PropertyAccess { path, .. }) => {
            path.first().is_some_and(|root| root == namespace)
        }
        _ => false,
    }
}

pub(crate) fn child_values(value: &StaticSyntaxValue) -> Vec<&StaticSyntaxValue> {
    match value {
        StaticSyntaxValue::Array { elements } => elements.iter().collect(),
        StaticSyntaxValue::Object { properties, .. } => properties
            .iter()
            .filter(|property| property.spread != Some(true))
            .map(|property| &property.value)
            .collect(),
        StaticSyntaxValue::Call { receiver, args, .. } => receiver
            .iter()
            .map(|value| value.as_ref())
            .chain(args.iter())
            .collect(),
        StaticSyntaxValue::Template { expressions, .. } => expressions.iter().collect(),
        StaticSyntaxValue::TaggedTemplate { expressions, .. } => expressions
            .iter()
            .map(|expression| &expression.value)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn string_literals(values: &[StaticSyntaxValue]) -> Vec<Value> {
    values
        .iter()
        .filter_map(|value| match value {
            StaticSyntaxValue::Literal {
                value: LiteralValue::String(value),
            } => Some(Value::String(value.clone())),
            _ => None,
        })
        .collect()
}

pub(crate) fn literal_json(value: &LiteralValue) -> Value {
    match value {
        LiteralValue::String(value) => Value::String(value.clone()),
        LiteralValue::Number(value) => json!(value),
        LiteralValue::Boolean(value) => Value::Bool(*value),
        LiteralValue::Null => Value::Null,
    }
}

pub(crate) fn insert_schema_value(schema: &mut Value, key: &str, value: Value) {
    if let Value::Object(object) = schema {
        object.insert(key.to_string(), value);
    }
}
