use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    extractors::context::PrimitiveContext,
    extractors::record_values::resolve_static_value,
    extractors::schema::common::{is_root_namespace, literal_json, object_schema},
    protocol::{LiteralValue, StaticSyntaxValue},
};

pub(crate) fn convex_value_to_json_schema(
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
    if matches!(expression, StaticSyntaxValue::Object { .. }) {
        return Some(convex_object_schema(expression, context, seen));
    }
    let StaticSyntaxValue::Call {
        callee,
        receiver,
        args,
        ..
    } = expression
    else {
        return None;
    };
    if !is_root_namespace(receiver.as_deref(), "v") {
        return None;
    }
    let first = args.first();
    match callee.name.as_str() {
        "optional" => convex_value_to_json_schema(first, context, &mut seen.clone()),
        "string" => Some(json!({"type": "string"})),
        "number" | "float64" => Some(json!({"type": "number"})),
        "int64" => Some(json!({"type": "integer"})),
        "boolean" => Some(json!({"type": "boolean"})),
        "null" => Some(json!({"type": "null"})),
        "any" => Some(json!({})),
        "id" => id_schema(first),
        "literal" => first.and_then(literal_schema),
        "array" => first.map(|item| json!({"type": "array", "items": convex_value_to_json_schema(Some(item), context, &mut seen.clone()).unwrap_or_else(|| json!({}))})),
        "object" => first.map(|item| convex_object_schema(item, context, &mut seen.clone())),
        "union" => union_schema(args, context, seen),
        "record" if args.len() >= 2 => Some(json!({"type": "object", "additionalProperties": convex_value_to_json_schema(args.get(1), context, &mut seen.clone()).unwrap_or_else(|| json!({}))})),
        _ => None,
    }
}

fn convex_object_schema(
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
            convex_value_to_json_schema(Some(&property.value), context, &mut seen.clone())
                .unwrap_or_else(|| json!({})),
        );
        if !is_optional_convex_value(&property.value) {
            required.push(Value::String(property.name.clone()));
        }
    }
    object_schema(fields, required)
}

fn is_optional_convex_value(value: &StaticSyntaxValue) -> bool {
    matches!(
        value,
        StaticSyntaxValue::Call { callee, receiver, .. }
            if callee.name == "optional" && is_root_namespace(receiver.as_deref(), "v")
    )
}

fn id_schema(value: Option<&StaticSyntaxValue>) -> Option<Value> {
    let Some(StaticSyntaxValue::Literal {
        value: LiteralValue::String(table),
    }) = value
    else {
        return None;
    };
    Some(json!({"type": "string", "format": "convex-id", "table": table}))
}

fn literal_schema(value: &StaticSyntaxValue) -> Option<Value> {
    match value {
        StaticSyntaxValue::Literal { value } => Some(json!({"const": literal_json(value)})),
        _ => None,
    }
}

fn union_schema(
    args: &[StaticSyntaxValue],
    context: &PrimitiveContext<'_>,
    seen: &mut HashSet<String>,
) -> Option<Value> {
    let variants = args
        .iter()
        .filter_map(|argument| {
            convex_value_to_json_schema(Some(argument), context, &mut seen.clone())
        })
        .collect::<Vec<_>>();
    (!variants.is_empty()).then(|| json!({ "anyOf": variants }))
}
