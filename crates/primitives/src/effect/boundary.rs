//! Required-boundary evidence for statically irreversible Effects.

use serde_json::{Value, json};

use crate::{
    context::{PrimitiveContext, call_parts},
    effect::irreversible_effect_identity,
    manifest::CustomProjectionInput,
    protocol::{LiteralValue, StaticFunctionCallValue, StaticSyntaxValue},
};

const PUBLIC_EFFECT_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/effect"];

pub(super) fn required_boundary_refs(
    input: &CustomProjectionInput<'_>,
    definition_id: &str,
) -> Vec<Value> {
    input
        .matches
        .iter()
        .flat_map(|source_match| {
            let Some(parts) = call_parts(source_match) else {
                return Vec::new();
            };
            if !is_required_boundary_call(&parts) || !is_required_boundary(parts.args.get(1)) {
                return Vec::new();
            }
            let Some(StaticSyntaxValue::Function { calls, .. }) = parts.args.first() else {
                return Vec::new();
            };
            let context = PrimitiveContext::new(
                input.file,
                input.relative_path,
                input.imports,
                input.local_initializers,
                &parts,
            );
            calls
                .iter()
                .filter_map(|call| {
                    required_boundary_ref(
                        input.relative_path,
                        definition_id,
                        &context,
                        &parts,
                        call,
                    )
                })
                .collect()
        })
        .collect()
}

fn required_boundary_ref(
    relative_path: &str,
    expected_definition_id: &str,
    context: &PrimitiveContext<'_>,
    boundary: &crate::context::CallParts<'_>,
    call: &StaticFunctionCallValue,
) -> Option<Value> {
    let target = call_reference(call)?;
    let resolved = context.resolve_record_source(Some(&target))??;
    let (effect_id, definition_id) = irreversible_effect_identity(resolved.value)?;
    if definition_id != expected_definition_id {
        return None;
    }
    Some(json!({
        "definitionId": definition_id,
        "ref": {
            "id": format!(
                "{definition_id}:source:required-boundary:{}:{}:{}:{}:{}",
                super::path_identity(relative_path),
                boundary.source.line,
                boundary.source.column,
                call.source.line,
                call.source.column,
            ),
            "role": "config",
            "property": "rollbackOnError.recovery",
            "symbol": "rollbackOnError",
            "source": boundary.source,
            "snippet": boundary.snippet,
            "fidelity": "resolved",
            "description": format!(
                "Required-recovery boundary contains irreversible Effect \"{effect_id}\""
            ),
        }
    }))
}

fn is_required_boundary_call(parts: &crate::context::CallParts<'_>) -> bool {
    parts.match_kind == "call"
        && parts.callee_name == "rollbackOnError"
        && parts.callee_direct != Some(false)
        && parts
            .callee_module_specifier
            .is_some_and(|module| PUBLIC_EFFECT_MODULES.contains(&module))
}

fn call_reference(call: &StaticFunctionCallValue) -> Option<StaticSyntaxValue> {
    let name = call
        .callee
        .local_name
        .as_deref()
        .unwrap_or(call.callee.name.as_str());
    if call.callee.direct != Some(false) {
        return Some(StaticSyntaxValue::Identifier {
            name: name.to_string(),
        });
    }
    let mut path = reference_path(call.receiver.as_deref()?)?;
    path.push(name.to_string());
    Some(StaticSyntaxValue::PropertyAccess {
        name: name.to_string(),
        path,
    })
}

fn reference_path(value: &StaticSyntaxValue) -> Option<Vec<String>> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(vec![name.clone()]),
        StaticSyntaxValue::PropertyAccess { path, .. } => Some(path.clone()),
        _ => None,
    }
}

fn is_required_boundary(options: Option<&StaticSyntaxValue>) -> bool {
    let Some(options) = options else {
        return true;
    };
    let StaticSyntaxValue::Object { properties, .. } = options else {
        return false;
    };
    if properties
        .iter()
        .any(|property| property.spread == Some(true))
    {
        return false;
    }
    let recovery = properties
        .iter()
        .filter(|property| property.name == "recovery")
        .next_back()
        .map(|property| &property.value);
    match recovery {
        None => true,
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => value == "required",
        Some(_) => false,
    }
}
