use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_string_property, object_value, property_value, reference_property,
        resolve_static_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn ingest_source_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    let declared_kind = match parts.callee_name {
        "fileSource" | "filesSource" => "file",
        "urlSource" | "urlsSource" => "url",
        "textSource" => "custom",
        _ => return None,
    };
    let config = parts
        .object_arg
        .or_else(|| parts.args.get(1))
        .and_then(object_value);
    let mut facts = Map::new();
    facts.insert("kind".into(), json!("ingest.source"));
    facts.insert(
        "sourceKind".into(),
        json!(source_kind(parts, declared_kind)),
    );
    insert_allowed_array(
        &mut facts,
        config,
        "mediaKinds",
        &["text", "image", "audio", "video", "document"],
        context,
    );
    if let Some(namespace) = config.and_then(|value| direct_string_property(value, "namespace")) {
        facts.insert("namespace".into(), Value::String(namespace));
    }
    insert_allowed_array(
        &mut facts,
        config,
        "attribution",
        &["page", "time"],
        context,
    );

    let mut metadata = Map::new();
    if parts.exported {
        metadata.insert("exportName".into(), json!(parts.variable_name));
    }
    metadata.insert("facts".into(), Value::Object(facts));
    metadata.insert("indexPresentation".into(), json!({ "standalone": true }));
    let mut definition = static_index_definition(NativeDefinitionInput {
        id: format!("ingest.source:{}", safe_id(parts.variable_name)),
        kind: "ingest.source",
        name: parts.variable_name.to_string(),
        file: context.fingerprint_file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    definition.as_object_mut()?.remove("sourceSnippet");
    Some(extracted_facts(
        parts.variable_name,
        definition,
        Vec::new(),
        ingest_relations(config, context),
        Vec::new(),
    ))
}

fn ingest_relations(
    config: Option<&StaticSyntaxValue>,
    context: &PrimitiveContext<'_>,
) -> Vec<Value> {
    let Some(config) = config else {
        return Vec::new();
    };
    [
        ("media.derives_with", "derivation"),
        ("media.targets_index", "index"),
        ("media.targets_corpus", "corpus"),
    ]
    .into_iter()
    .filter_map(|(relation, property)| {
        reference_property(config, property, &context.initializers)
            .map(|target| json!({ "type": relation, "toVariable": target }))
    })
    .collect()
}

fn source_kind(parts: &CallParts<'_>, declared_kind: &'static str) -> &'static str {
    if declared_kind != "file" {
        return declared_kind;
    }
    match parts.args.first() {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(_),
        }) => "file",
        Some(StaticSyntaxValue::Array { elements })
            if elements.iter().all(|value| {
                matches!(
                    value,
                    StaticSyntaxValue::Literal {
                        value: LiteralValue::String(_)
                    }
                )
            }) =>
        {
            "file"
        }
        Some(StaticSyntaxValue::Object { .. }) => "asset",
        _ => "custom",
    }
}

fn insert_allowed_array(
    facts: &mut Map<String, Value>,
    config: Option<&StaticSyntaxValue>,
    property: &str,
    allowed: &[&str],
    context: &PrimitiveContext<'_>,
) {
    let Some(value) = config.and_then(|value| property_value(value, property)) else {
        return;
    };
    let value = resolve_static_value(
        value,
        &context.initializers,
        &mut std::collections::HashSet::new(),
    );
    let StaticSyntaxValue::Array { elements } = value else {
        return;
    };
    let found = allowed
        .iter()
        .filter(|allowed| elements.iter().any(|value| matches!(value, StaticSyntaxValue::Literal { value: LiteralValue::String(item) } if item == **allowed)))
        .map(|value| Value::String((*value).to_string()))
        .collect::<Vec<_>>();
    if !found.is_empty() {
        facts.insert(property.into(), Value::Array(found));
    }
}
