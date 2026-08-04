use serde_json::{Value, json};

use crate::{
    context::{PrimitiveContext, ResolvedSource},
    protocol::{StaticCalleeRecord, StaticSyntaxValue},
    record_values::{direct_string_property, object_property, property_value},
};

pub(crate) const SIGNAL_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/signal"];
pub(crate) const PROVIDER_MODULES: &[&str] =
    &["@use-crux/core", "@use-crux/core/signal/provider"];
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
    "onEvent",
    "secret",
    "token",
    "password",
    "apiKey",
];

pub(crate) fn webhook_kind(
    resolved: Option<&StaticSyntaxValue>,
    value: Option<&StaticSyntaxValue>,
) -> Option<&'static str> {
    let call = match resolved.or(value) {
        Some(StaticSyntaxValue::Call { callee, .. }) => callee,
        _ => return None,
    };
    if callee_name(call) != "webhook" {
        return None;
    }
    if let Some(module) = call.module_specifier.as_deref() {
        if !TRANSPORT_MODULES.contains(&module) {
            return None;
        }
    }
    Some("webhook")
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
        if let Some(module) = call.0.module_specifier.as_deref() {
            if !SIGNAL_MODULES.contains(&module) {
                continue;
            }
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

pub(crate) fn provider_definition_id(resolved: Option<&ResolvedSource<'_>>) -> Option<String> {
    provider_id_from_resolved(resolved).map(|id| format!("signal.provider:{id}"))
}

pub(crate) fn provider_id_from_resolved(resolved: Option<&ResolvedSource<'_>>) -> Option<String> {
    let StaticSyntaxValue::Call { callee, args, .. } = resolved?.value else {
        return None;
    };
    if callee_name(callee) != "signalProvider" {
        return None;
    }
    if let Some(module) = callee.module_specifier.as_deref() {
        if !PROVIDER_MODULES.contains(&module) {
            return None;
        }
    }
    args.first()
        .and_then(|config| direct_string_property(config, "id"))
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

