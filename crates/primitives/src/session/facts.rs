use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, source_ref, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::direct_string_property,
    routing::output::extracted_facts,
};

const AGENT_MODULES: &[&str] = &[
    "@use-crux/core/agent",
    "@use-crux/convex",
    "@use-crux/convex/agent",
];

const FLOW_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/flow"];

/// Projects authored Session construction and keyed lookup evidence.
pub(crate) fn session_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    let operation = match parts.callee_name {
        "session" => "create",
        "getSession" => "get",
        _ => return None,
    };
    if parts.match_kind != "call" || parts.callee_direct == Some(false) {
        return None;
    }

    let target_value = parts.args.first()?;
    let target_variable = target_reference_name(target_value);
    let target = context.resolve_record_source(Some(target_value))?;
    let resolved_target = target.as_ref().and_then(session_target_definition);
    let key = session_key(operation, parts.args.get(1));
    let target_name = resolved_target
        .as_ref()
        .map(|resolved| resolved.name.clone())
        .or_else(|| target_variable.clone());
    let stable = resolved_target.is_some() && key.is_some();
    let authored_identity = if stable {
        format!("{}:{}", target_name.as_deref()?, key.as_deref()?)
    } else {
        format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        )
    };
    let id = format!("session:{}", safe_id(&authored_identity));

    let mut session_metadata = Map::new();
    session_metadata.insert("kind".to_string(), Value::String("session".to_string()));
    session_metadata.insert(
        "operation".to_string(),
        Value::String(operation.to_string()),
    );
    if let Some(target_variable) = &target_variable {
        session_metadata.insert(
            "targetVariable".to_string(),
            Value::String(target_variable.clone()),
        );
    }
    if let Some(resolved) = &resolved_target {
        session_metadata.insert(
            "targetDefinitionId".to_string(),
            Value::String(resolved.definition_id.clone()),
        );
    }
    session_metadata.insert(
        "target".to_string(),
        json!({
            "kind": if let Some(resolved) = &resolved_target {
                resolved.kind
            } else if matches!(target_value, StaticSyntaxValue::Identifier { .. } | StaticSyntaxValue::PropertyAccess { .. }) {
                "unresolved"
            } else {
                "dynamic"
            }
        }),
    );
    session_metadata.insert(
        "key".to_string(),
        key.as_ref().map_or_else(
            || json!({ "kind": "dynamic" }),
            |value| json!({ "kind": "literal", "value": value }),
        ),
    );
    session_metadata.insert(
        "identity".to_string(),
        Value::String(if stable { "static" } else { "partial" }.to_string()),
    );
    session_metadata.insert(
        "call".to_string(),
        session_call(context, operation, parts.args),
    );

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    parts.add_direct_export_evidence(&mut metadata);
    metadata.insert("facts".to_string(), Value::Object(session_metadata));

    let references = if let Some(resolved) = &resolved_target {
        vec![json!({
            "type": resolved.relation_type,
            "toId": resolved.definition_id,
        })]
    } else {
        target_variable
            .map(|to_variable| {
                vec![json!({
                    "type": "session.targets_agent",
                    "toVariable": to_variable,
                })]
            })
            .unwrap_or_default()
    };
    let source_refs = target
        .map(|resolved| {
            vec![source_ref(
                &id,
                "config",
                "target",
                &resolved.symbol,
                &resolved.source,
                resolved.function_name.as_deref(),
                resolved.snippet.as_ref(),
            )]
        })
        .unwrap_or_default();

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "session",
            name: if stable {
                format!("{}:{}", target_name?, key?)
            } else {
                parts.variable_name.to_string()
            },
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        source_refs,
    ))
}

fn session_key(operation: &str, value: Option<&StaticSyntaxValue>) -> Option<String> {
    if operation == "create" {
        return value.and_then(|config| direct_string_property(config, "key"));
    }
    match value {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}

fn target_reference_name(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Identifier { name } | StaticSyntaxValue::PropertyAccess { name, .. } => {
            Some(name.clone())
        }
        StaticSyntaxValue::Call { callee, .. } => Some(
            callee
                .local_name
                .as_deref()
                .unwrap_or(&callee.name)
                .to_string(),
        ),
        _ => None,
    }
}

fn session_call(
    context: &PrimitiveContext<'_>,
    operation: &str,
    args: &[StaticSyntaxValue],
) -> Value {
    if args.len() != 2 {
        return json!({ "kind": "ambiguous", "reason": "arity" });
    }
    if operation == "get" {
        return json!({ "kind": "supported" });
    }
    let options = args.get(1);
    let resolved = context
        .resolve_record_source(options)
        .flatten()
        .map(|source| source.value)
        .or(options);
    if resolved.is_some_and(|value| matches!(value, StaticSyntaxValue::Object { .. })) {
        json!({ "kind": "supported" })
    } else {
        json!({ "kind": "ambiguous", "reason": "options" })
    }
}

struct ResolvedSessionTarget {
    kind: &'static str,
    definition_id: String,
    name: String,
    relation_type: &'static str,
}

fn session_target_definition(
    resolved: &crate::context::ResolvedSource<'_>,
) -> Option<ResolvedSessionTarget> {
    let StaticSyntaxValue::Call { callee, args, .. } = resolved.value else {
        return None;
    };
    let producer = callee.imported_name.as_deref().unwrap_or(&callee.name);
    let module = callee.module_specifier.as_deref()?;

    if matches!(producer, "agent" | "convexAgent") && AGENT_MODULES.contains(&module) {
        let explicit_id = args
            .first()
            .and_then(|config| direct_string_property(config, "id"));
        let name = explicit_id
            .clone()
            .unwrap_or_else(|| resolved.definition_symbol.clone());
        return Some(ResolvedSessionTarget {
            kind: "agent",
            definition_id: format!("agent:{}", safe_id(&name)),
            name,
            relation_type: "session.targets_agent",
        });
    }

    if matches!(producer, "flow" | "cruxFlow") && FLOW_MODULES.contains(&module) {
        // Public API: flow(name, handler) or flow(name, options, handler).
        let string_name = args.first().and_then(|value| match value {
            StaticSyntaxValue::Literal {
                value: LiteralValue::String(value),
            } => Some(value.clone()),
            _ => None,
        });
        let object_name = args
            .first()
            .and_then(|config| direct_string_property(config, "name"));
        let name = string_name
            .or(object_name)
            .unwrap_or_else(|| resolved.definition_symbol.clone());
        return Some(ResolvedSessionTarget {
            kind: "flow",
            definition_id: format!("flow:{}", safe_id(&name)),
            name,
            relation_type: "session.targets_flow",
        });
    }

    None
}
