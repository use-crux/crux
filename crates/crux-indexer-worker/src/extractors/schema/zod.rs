use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    extractors::context::PrimitiveContext,
    extractors::record_values::resolve_static_value,
    extractors::schema::common::{
        insert_schema_value, is_root_namespace, literal_json, object_schema, string_literals,
    },
    protocol::{LiteralValue, StaticSyntaxValue},
};

pub(crate) fn zod_value_to_json_schema(
    value: Option<&StaticSyntaxValue>,
    context: &PrimitiveContext<'_>,
    seen: &mut HashSet<String>,
) -> Option<Value> {
    if let Some(StaticSyntaxValue::Identifier { name }) = value {
        if !seen.insert(format!("local:{name}")) {
            return None;
        }
    }
    let expression = value.map(|value| resolve_static_value(value, &context.initializers, seen))?;
    let StaticSyntaxValue::Call {
        callee,
        receiver,
        args,
        ..
    } = expression
    else {
        return None;
    };
    let method = callee.name.as_str();
    let first = args.first();
    let receiver_schema = receiver
        .as_ref()
        .and_then(|receiver| zod_value_to_json_schema(Some(receiver), context, &mut seen.clone()));
    let is_zod_root = is_root_namespace(receiver.as_deref(), "z");

    match (method, is_zod_root, first) {
        ("object", true, Some(StaticSyntaxValue::Object { .. })) => {
            return Some(zod_object_schema(first?, context, seen));
        }
        ("array", true, Some(item)) => {
            return Some(
                json!({"type": "array", "items": zod_value_to_json_schema(Some(item), context, &mut seen.clone()).unwrap_or_else(|| json!({}))}),
            );
        }
        ("enum", true, Some(StaticSyntaxValue::Array { elements })) => {
            return Some(json!({"type": "string", "enum": string_literals(elements)}));
        }
        ("string", true, _) => return Some(json!({"type": "string"})),
        ("number", true, _) => return Some(json!({"type": "number"})),
        ("boolean", true, _) => return Some(json!({"type": "boolean"})),
        ("literal", true, Some(StaticSyntaxValue::Literal { value })) => {
            return Some(json!({"const": literal_json(value)}));
        }
        _ => {}
    }

    let mut schema = receiver_schema?;
    match method {
        "optional" => Some(schema),
        "describe" => {
            if let Some(StaticSyntaxValue::Literal {
                value: LiteralValue::String(description),
            }) = first
            {
                insert_schema_value(
                    &mut schema,
                    "description",
                    Value::String(description.clone()),
                );
            }
            Some(schema)
        }
        "default" => {
            if let Some(StaticSyntaxValue::Literal { value }) = first {
                insert_schema_value(&mut schema, "default", literal_json(value));
            }
            Some(schema)
        }
        "max" => Some(numeric_zod_bound(schema, first, "max")),
        "min" => Some(numeric_zod_bound(schema, first, "min")),
        _ => Some(schema),
    }
}

fn zod_object_schema(
    value: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
    seen: &mut HashSet<String>,
) -> Value {
    let StaticSyntaxValue::Object { properties, .. } = value else {
        return json!({});
    };
    let mut fields = Map::new();
    let mut required = Vec::new();
    for property in properties
        .iter()
        .filter(|property| property.spread != Some(true))
    {
        fields.insert(
            property.name.clone(),
            zod_value_to_json_schema(Some(&property.value), context, &mut seen.clone())
                .unwrap_or_else(|| json!({})),
        );
        if !is_optional_zod_value(&property.value, context, &mut seen.clone()) {
            required.push(Value::String(property.name.clone()));
        }
    }
    object_schema(fields, required)
}

fn numeric_zod_bound(mut schema: Value, arg: Option<&StaticSyntaxValue>, bound: &str) -> Value {
    let Some(StaticSyntaxValue::Literal {
        value: LiteralValue::Number(value),
    }) = arg
    else {
        return schema;
    };
    let key = match schema.get("type").and_then(Value::as_str) {
        Some("array") if bound == "min" => "minItems",
        Some("array") => "maxItems",
        Some("number") if bound == "min" => "minimum",
        Some("number") => "maximum",
        Some("string") if bound == "min" => "minLength",
        Some("string") => "maxLength",
        _ => return schema,
    };
    insert_schema_value(&mut schema, key, json!(value));
    schema
}

fn is_optional_zod_value(
    value: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
    seen: &mut HashSet<String>,
) -> bool {
    matches!(
        value,
        StaticSyntaxValue::Call { callee, receiver, .. }
            if callee.name == "optional" && zod_value_to_json_schema(receiver.as_deref(), context, &mut seen.clone()).is_some()
    )
}
