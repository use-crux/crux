use std::collections::HashSet;

use crate::{
    context::PrimitiveContext,
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{property_value, resolve_static_value},
};

#[derive(Default)]
pub(crate) struct MemoryIdInfo {
    pub(crate) definition_key: Option<String>,
    pub(crate) display_name: Option<String>,
    pub(crate) runtime_id_prefix: Option<String>,
}

pub(crate) fn authored_memory_id(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> MemoryIdInfo {
    let Some(expression) = property_value(config, "id") else {
        return MemoryIdInfo::default();
    };
    let resolved = resolve_static_value(expression, &context.initializers, &mut HashSet::new());
    if let StaticSyntaxValue::Literal {
        value: LiteralValue::String(value),
    } = resolved
    {
        return static_memory_id(value.clone(), value.clone(), None);
    }
    if let Some(prefix) = create_memory_id_prefix(resolved) {
        let key = prefix.strip_suffix(':').unwrap_or(&prefix).to_string();
        return static_memory_id(key, format!("{prefix}*"), Some(prefix));
    }
    if let StaticSyntaxValue::Identifier { name } = expression {
        return static_memory_id(name.clone(), name.clone(), None);
    }
    MemoryIdInfo::default()
}

fn static_memory_id(
    definition_key: String,
    display_name: String,
    runtime_id_prefix: Option<String>,
) -> MemoryIdInfo {
    MemoryIdInfo {
        definition_key: Some(definition_key),
        display_name: Some(display_name),
        runtime_id_prefix,
    }
}

fn create_memory_id_prefix(value: &StaticSyntaxValue) -> Option<String> {
    let StaticSyntaxValue::Call { callee, args, .. } = value else {
        return None;
    };
    if callee.name != "createMemoryId" {
        return None;
    }
    let Some(StaticSyntaxValue::Literal {
        value: LiteralValue::String(memory_type),
    }) = args.first()
    else {
        return None;
    };
    memory_id_prefix_for_type(memory_type).map(|prefix| format!("{prefix}:"))
}

fn memory_id_prefix_for_type(memory_type: &str) -> Option<&'static str> {
    match memory_type {
        "session" => Some("session"),
        "semantic" => Some("project-knowledge"),
        "episodic" => Some("user-episodes"),
        "blackboard" => Some("thread"),
        _ => None,
    }
}
