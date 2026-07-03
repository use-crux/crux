use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext, source_ref_for_callback_property},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    routing::output::extracted_facts,
};

pub(crate) fn runtime_task_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "task"
        || parts.callee_direct == Some(false)
        || parts.callee_module_specifier != Some("@use-crux/core/runtime")
    {
        return None;
    }

    let explicit_name = string_argument(parts.args.first());
    let target_name = explicit_name
        .clone()
        .unwrap_or_else(|| parts.variable_name.to_string());
    let id = format!(
        "task:{}",
        safe_id(explicit_name.as_deref().unwrap_or(parts.local_name))
    );

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert(
        "runtimeTarget".to_string(),
        json!({
            "kind": "task",
            "nameLiteral": explicit_name.is_some(),
            "exported": parts.exported,
        }),
    );
    metadata.insert(
        "facts".to_string(),
        json!({
            "kind": "task",
            "runtime": true,
        }),
    );
    metadata.insert(
        "intelligence".to_string(),
        json!({
            "confidence": "static",
            "control": {
                "mode": "durable",
            },
        }),
    );

    let source_refs = parts
        .object_arg
        .and_then(|config| {
            source_ref_for_callback_property(context, &id, config, "run", "execute")?
        })
        .into_iter()
        .collect();

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "task",
            name: target_name,
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        source_refs,
    ))
}

fn string_argument(value: Option<&StaticSyntaxValue>) -> Option<String> {
    match value {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}
