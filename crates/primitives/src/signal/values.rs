use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::{
    context::{PrimitiveContext, ResolvedSource},
    protocol::{LiteralValue, StaticCalleeRecord, StaticInitializerRecord, StaticSyntaxValue},
    record_values::{
        direct_string_property, object_property, property_value, resolve_static_value,
    },
};

pub(crate) const SIGNAL_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/signal"];
pub(crate) const PROVIDER_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/signal/provider"];
pub(crate) const TRANSPORT_MODULES: &[&str] =
    &["@use-crux/core", "@use-crux/core/signal/transport"];
const LIVE_FIELDS: &[&str] = &[
    "request",
    "client",
    "credential",
    "credentials",
    "socket",
    "callback",
    "handle",
    "poll",
    "open",
    "onEvent",
    "secret",
    "token",
    "password",
    "apiKey",
];

/// Resolves one string property through the initializer evidence visible at the call site.
pub(crate) fn string_property(
    object: &StaticSyntaxValue,
    name: &str,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<String> {
    match property_value(object, name)
        .map(|value| resolve_static_value(value, initializers, &mut HashSet::new()))
    {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}

pub(crate) fn transport_kind(
    resolved: Option<&StaticSyntaxValue>,
    value: Option<&StaticSyntaxValue>,
) -> Option<&'static str> {
    let call = match resolved.or(value) {
        Some(StaticSyntaxValue::Call { callee, .. }) => callee,
        _ => return None,
    };
    let name = callee_name(call);
    if name != "webhook" && name != "polling" && name != "stream" && name != "sse" {
        return None;
    }
    if !call
        .module_specifier
        .as_deref()
        .is_some_and(|module| TRANSPORT_MODULES.contains(&module))
    {
        return None;
    }
    Some(match name {
        "polling" => "polling",
        "stream" => "stream",
        "sse" => "sse",
        _ => "webhook",
    })
}

pub(crate) fn signal_map(
    context: &PrimitiveContext<'_>,
    value: Option<&StaticSyntaxValue>,
) -> (Vec<String>, Vec<String>) {
    let Some(StaticSyntaxValue::Object { properties, .. }) = value else {
        return (Vec::new(), Vec::new());
    };
    let mut signal_ids = Vec::new();
    let mut signal_variables = Vec::new();
    for property in properties {
        if property.spread == Some(true) {
            continue;
        }
        if let Some(variable) = reference_name(Some(&property.value)) {
            signal_variables.push(variable);
        }
        let resolved = context
            .resolve_record_source(Some(&property.value))
            .flatten();
        let call = match resolved
            .as_ref()
            .map(|value| value.value)
            .or(Some(&property.value))
        {
            Some(StaticSyntaxValue::Call { callee, args, .. }) => (callee, args.as_slice()),
            _ => continue,
        };
        if callee_name(call.0) != "signal" {
            continue;
        }
        if !call
            .0
            .module_specifier
            .as_deref()
            .is_some_and(|module| SIGNAL_MODULES.contains(&module))
        {
            continue;
        }
        if let Some(config) = call.1.first() {
            if let Some(signal_id) = direct_string_property(config, "id") {
                signal_ids.push(signal_id);
            }
        }
    }
    signal_ids.sort();
    signal_ids.dedup();
    signal_variables.sort();
    signal_variables.dedup();
    (signal_ids, signal_variables)
}

pub(crate) fn provider_definition_id(
    context: &PrimitiveContext<'_>,
    resolved: Option<&ResolvedSource<'_>>,
) -> Option<String> {
    provider_id_from_resolved(context, resolved)
        .map(|id| format!("signal.provider:{}", crate::definition::safe_id(&id)))
}

pub(crate) fn provider_id_from_resolved(
    context: &PrimitiveContext<'_>,
    resolved: Option<&ResolvedSource<'_>>,
) -> Option<String> {
    let StaticSyntaxValue::Call { callee, args, .. } = resolved?.value else {
        return None;
    };
    if callee_name(callee) != "signalProvider" {
        return None;
    }
    if !callee
        .module_specifier
        .as_deref()
        .is_some_and(|module| PROVIDER_MODULES.contains(&module))
    {
        return None;
    }
    args.first()
        .and_then(|config| string_property(config, "id", &context.initializers))
}

pub(crate) fn config_ref_fact(options: &StaticSyntaxValue) -> Option<Value> {
    let value = property_value(options, "configRef")?;
    match value {
        StaticSyntaxValue::Object { .. } => {
            let id = direct_string_property(value, "id");
            let revision = direct_string_property(value, "revision");
            if let (Some(id), Some(revision)) = (id, revision) {
                Some(json!({ "kind": "literal", "id": id, "revision": revision }))
            } else {
                Some(json!({ "kind": "partial" }))
            }
        }
        StaticSyntaxValue::Identifier { .. } | StaticSyntaxValue::PropertyAccess { .. } => {
            Some(json!({ "kind": "partial" }))
        }
        _ => Some(json!({ "kind": "dynamic" })),
    }
}

pub(crate) fn live_fields(options: &StaticSyntaxValue) -> Vec<&'static str> {
    let StaticSyntaxValue::Object { properties, .. } = options else {
        return Vec::new();
    };
    let mut fields = properties
        .iter()
        .filter_map(|property| {
            if property.spread == Some(true) {
                return None;
            }
            LIVE_FIELDS
                .iter()
                .copied()
                .find(|field| *field == property.name.as_str())
        })
        .collect::<Vec<_>>();
    fields.sort_unstable();
    fields.dedup();
    fields
}

pub(crate) fn reference_name(value: Option<&StaticSyntaxValue>) -> Option<String> {
    match value? {
        StaticSyntaxValue::Identifier { name } => Some(name.clone()),
        StaticSyntaxValue::PropertyAccess { name, .. } => Some(name.clone()),
        _ => None,
    }
}

pub(crate) fn callee_name(callee: &StaticCalleeRecord) -> &str {
    callee
        .imported_name
        .as_deref()
        .unwrap_or(callee.name.as_str())
}

pub(crate) fn config_source_refs(
    definition_id: &str,
    options: &StaticSyntaxValue,
    properties: &[&str],
    label: &str,
) -> Vec<Value> {
    properties
        .iter()
        .filter_map(|property| {
            let authored = object_property(options, property)?;
            Some(json!({
                "definitionId": definition_id,
                "ref": {
                    "id": format!(
                        "{definition_id}:source:config:{property}:{}:{}",
                        authored.source.line, authored.source.column
                    ),
                    "role": "config",
                    "property": property,
                    "source": authored.source,
                    "fidelity": "resolved",
                    "description": format!("Authored {label} {property} expression."),
                }
            }))
        })
        .collect()
}
