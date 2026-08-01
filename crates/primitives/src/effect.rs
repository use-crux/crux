//! Static projection for public custom Effect definitions.

mod boundary;

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::{
    context::call_parts,
    definition::{NativeDefinitionInput, safe_id, source_ref, static_index_definition},
    manifest::CustomProjectionInput,
    protocol::{LiteralValue, StaticSourceMatch, StaticSyntaxValue},
    routing::output::extracted_facts,
};

/// Projects one binding-resolved public `effect()` call.
pub(crate) fn effect_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    let parts = public_effect_parts(input.source_match)?;
    let ordinal = input.matches[..=input.match_index]
        .iter()
        .filter(|source_match| public_effect_parts(source_match).is_some())
        .count();
    let effect_id = parts.args.first().and_then(literal_string);
    let options = parts.args.get(2).filter(|value| is_object(value));
    let has_options = parts.args.len() > 2;
    let version = effect_version(options, has_options);
    let analyzable = effect_id.is_some() && version.is_some();
    let id = match (effect_id, version) {
        (Some(effect_id), Some(version)) => {
            format!("effect:{}:v{}", safe_id(effect_id), format_number(version))
        }
        _ => format!(
            "effect:unanalyzable:{}:{ordinal}",
            safe_id(input.relative_path)
        ),
    };
    let name = effect_id.unwrap_or(parts.variable_name);
    let facts = effect_metadata_facts(effect_id, version, options, has_options);
    let mut metadata = Map::new();
    metadata.insert(
        "indexPresentation".to_string(),
        json!({ "standalone": true }),
    );
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if parts.exported {
        metadata.insert("exported".to_string(), Value::Bool(true));
    }
    metadata.insert("facts".to_string(), facts);

    let mut definition = static_index_definition(NativeDefinitionInput {
        id: id.clone(),
        kind: "effect",
        name: name.to_string(),
        file: input.relative_path,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    let definition_object = definition.as_object_mut()?;
    if !analyzable {
        definition_object.insert("fidelity".to_string(), Value::String("partial".to_string()));
    }
    let definition_metadata = definition_object.get_mut("metadata")?.as_object_mut()?;
    if analyzable {
        definition_metadata.insert(
            "runtimeJoin".to_string(),
            effect_runtime_join(&id, effect_id?, version?),
        );
    } else {
        definition_metadata.remove("runtimeJoin");
        definition_metadata.insert(
            "sourceStatus".to_string(),
            json!({ "partialReason": "Effect id or version is not a literal" }),
        );
    }

    let executor = parts.args.get(1).and_then(identifier).unwrap_or("inline");
    let mut executor_ref = source_ref(
        &id,
        "execute",
        "executor",
        executor,
        parts.source,
        (executor != "inline").then_some(executor),
        parts.snippet,
    );
    executor_ref["ref"]["id"] = Value::String(format!(
        "{id}:source:execute:executor:{executor}:{}:{ordinal}",
        path_identity(input.relative_path)
    ));

    let mut source_refs = vec![executor_ref];
    source_refs.extend(boundary::required_boundary_refs(input, &id));
    Some(extracted_facts(
        parts.variable_name,
        definition,
        Vec::new(),
        Vec::new(),
        source_refs,
    ))
}

pub(super) fn irreversible_effect_identity(value: &StaticSyntaxValue) -> Option<(String, String)> {
    let StaticSyntaxValue::Call { callee, args, .. } = value else {
        return None;
    };
    if callee.name != "effect"
        || callee.direct == Some(false)
        || !matches!(
            callee.module_specifier.as_deref(),
            Some("@use-crux/core" | "@use-crux/core/effect")
        )
    {
        return None;
    }
    let effect_id = args.first().and_then(literal_string)?;
    let options = args.get(2).filter(|value| is_object(value));
    let has_options = args.len() > 2;
    let version = effect_version(options, has_options)?;
    let facts = effect_metadata_facts(Some(effect_id), Some(version), options, has_options);
    (facts.get("recoverable").and_then(Value::as_bool) == Some(false)).then(|| {
        (
            effect_id.to_string(),
            format!("effect:{}:v{}", safe_id(effect_id), format_number(version)),
        )
    })
}

fn effect_metadata_facts(
    effect_id: Option<&str>,
    version: Option<f64>,
    options: Option<&StaticSyntaxValue>,
    has_options: bool,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("effect".to_string()));
    if let Some(effect_id) = effect_id {
        facts.insert("effectId".to_string(), Value::String(effect_id.to_string()));
    }
    if let Some(version) = version {
        facts.insert("version".to_string(), json!(version));
    }
    match options {
        Some(options) => {
            let recover = effective_property(options, "recover");
            facts.insert("recoverable".to_string(), presence(&recover, false));
            facts.insert("capture".to_string(), capture_presence(&recover, false));
            facts.insert(
                "resource".to_string(),
                presence(&effective_property(options, "resource"), false),
            );
        }
        None if has_options => {
            for key in ["recoverable", "capture", "resource"] {
                facts.insert(key.to_string(), Value::String("unknown".to_string()));
            }
        }
        None => {
            for key in ["recoverable", "capture", "resource"] {
                facts.insert(key.to_string(), Value::Bool(false));
            }
        }
    }
    Value::Object(facts)
}

fn effect_runtime_join(id: &str, effect_id: &str, version: f64) -> Value {
    let version = format_number(version);
    json!({
        "definitionId": id,
        "kind": "effect",
        "name": effect_id,
        "primitive": "effect.run",
        "correlationAttributes": ["crux.effect.id", "crux.effect.version"],
        "spanAttributes": {
            "crux.effect.id": effect_id,
            "crux.effect.version": version,
        },
    })
}

fn effect_version(options: Option<&StaticSyntaxValue>, has_options: bool) -> Option<f64> {
    match options {
        Some(options) => match effective_property(options, "version") {
            EffectiveProperty::Known(StaticSyntaxValue::Literal {
                value: LiteralValue::Number(value),
            }) if value.is_finite() => Some(*value),
            EffectiveProperty::Absent => Some(1.0),
            EffectiveProperty::Known(_) | EffectiveProperty::Unknown => None,
        },
        None if has_options => None,
        None => Some(1.0),
    }
}

fn public_effect_parts(source_match: &StaticSourceMatch) -> Option<crate::context::CallParts<'_>> {
    let parts = call_parts(source_match)?;
    (parts.match_kind == "call"
        && parts.callee_name == "effect"
        && parts.callee_direct != Some(false)
        && matches!(
            parts.callee_module_specifier,
            Some("@use-crux/core" | "@use-crux/core/effect")
        ))
    .then_some(parts)
}

fn literal_string(value: &StaticSyntaxValue) -> Option<&str> {
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value),
        _ => None,
    }
}

fn identifier(value: &StaticSyntaxValue) -> Option<&str> {
    match value {
        StaticSyntaxValue::Identifier { name } => Some(name),
        _ => None,
    }
}

fn is_object(value: &StaticSyntaxValue) -> bool {
    matches!(value, StaticSyntaxValue::Object { .. })
}

fn format_number(value: f64) -> String {
    ryu_js::Buffer::new().format(value).to_string()
}

#[derive(Clone, Copy)]
enum EffectiveProperty<'a> {
    Absent,
    Unknown,
    Known(&'a StaticSyntaxValue),
}

fn effective_property<'a>(object: &'a StaticSyntaxValue, name: &str) -> EffectiveProperty<'a> {
    let StaticSyntaxValue::Object { properties, .. } = object else {
        return EffectiveProperty::Absent;
    };
    let mut result = EffectiveProperty::Absent;
    for property in properties {
        if property.spread == Some(true) {
            result = EffectiveProperty::Unknown;
        } else if property.name == name {
            result = EffectiveProperty::Known(&property.value);
        }
    }
    result
}

fn presence(property: &EffectiveProperty<'_>, unknown_container: bool) -> Value {
    match property {
        EffectiveProperty::Known(_) => Value::Bool(true),
        EffectiveProperty::Unknown => Value::String("unknown".to_string()),
        EffectiveProperty::Absent if unknown_container => Value::String("unknown".to_string()),
        EffectiveProperty::Absent => Value::Bool(false),
    }
}

fn capture_presence(recover: &EffectiveProperty<'_>, unknown_container: bool) -> Value {
    match recover {
        EffectiveProperty::Unknown => Value::String("unknown".to_string()),
        EffectiveProperty::Absent if unknown_container => Value::String("unknown".to_string()),
        EffectiveProperty::Absent => Value::Bool(false),
        EffectiveProperty::Known(StaticSyntaxValue::Function { .. }) => Value::Bool(false),
        EffectiveProperty::Known(recover) if is_object(recover) => {
            let capture = effective_property(recover, "capture");
            let execute = effective_property(recover, "execute");
            match (capture, execute) {
                (EffectiveProperty::Known(_), EffectiveProperty::Known(_)) => Value::Bool(true),
                (EffectiveProperty::Unknown, _) | (_, EffectiveProperty::Unknown) => {
                    Value::String("unknown".to_string())
                }
                _ => Value::Bool(false),
            }
        }
        EffectiveProperty::Known(_) => Value::String("unknown".to_string()),
    }
}

fn path_identity(relative_path: &str) -> String {
    let path_hash = Sha256::digest(relative_path.as_bytes());
    let hash = path_hash[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{}:{hash}", safe_id(relative_path))
}
