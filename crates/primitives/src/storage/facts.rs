use std::collections::HashSet;

use serde_json::{Value, json};

use crate::{
    context::{PrimitiveContext, call_parts},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    manifest::CustomProjectionInput,
    protocol::{LiteralValue, SourceLocation, SourceSnippet, StaticSourceMatch, StaticSyntaxValue},
    record_values::{direct_identifier, has_property, object_value, resolve_static_value},
    routing::output::extracted_facts,
    storage::{
        capabilities::{StorageFactoryDescriptor, storage_factory_descriptor},
        dependencies::{StorageReferences, storage_config_references, storage_relation_refs},
        metadata::{bundle_metadata, factory_metadata, scope_metadata},
    },
};

struct StorageParts<'a> {
    variable_name: &'a str,
    source: &'a SourceLocation,
    snippet: Option<&'a SourceSnippet>,
}

pub(crate) fn storage_native_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    match input.source_match {
        StaticSourceMatch::Call { .. } => storage_call_facts(input),
        StaticSourceMatch::Object {
            variable_name,
            object,
            source,
            snippet,
            local_initializers,
            ..
        } => {
            let context = PrimitiveContext::from_initializers(
                input.file,
                input.imports,
                input.local_initializers,
                local_initializers,
            );
            let parts = StorageParts {
                variable_name,
                source,
                snippet: snippet.as_ref(),
            };
            bundle_definition_facts(&context, &parts, object_value(object)?, None)
        }
        _ => None,
    }
}

fn storage_call_facts(input: &CustomProjectionInput<'_>) -> Option<Value> {
    let call = call_parts(input.source_match)?;
    let context = PrimitiveContext::new(input.file, input.imports, input.local_initializers, &call);
    let parts = StorageParts {
        variable_name: call.variable_name,
        source: call.source,
        snippet: call.snippet,
    };
    match call.callee_name {
        "storage" => storage_bundle_call_facts(&context, &parts, call.object_arg?),
        "scope" => storage_scope_facts(&context, &parts, call.args),
        name => {
            let descriptor = storage_factory_descriptor(name)?;
            Some(extracted_facts(
                parts.variable_name,
                storage_factory_definition(&context, &parts, descriptor),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ))
        }
    }
}

fn storage_bundle_call_facts(
    context: &PrimitiveContext<'_>,
    parts: &StorageParts<'_>,
    config: &StaticSyntaxValue,
) -> Option<Value> {
    let config = object_value(config)?;
    bundle_definition_facts(context, parts, config, Some("storage"))
}

fn bundle_definition_facts(
    context: &PrimitiveContext<'_>,
    parts: &StorageParts<'_>,
    config: &StaticSyntaxValue,
    backend: Option<&str>,
) -> Option<Value> {
    if !has_bundle_fields(config) {
        return None;
    }
    let refs = storage_config_references(Some(config), &context.initializers);
    let id = format!("storage.bundle:{}", safe_id(parts.variable_name));
    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "storage.bundle",
            name: parts.variable_name.to_string(),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata: bundle_metadata(parts.variable_name, backend, &refs),
        }),
        Vec::new(),
        bundle_relation_refs(&refs),
        Vec::new(),
    ))
}

fn storage_scope_facts(
    context: &PrimitiveContext<'_>,
    parts: &StorageParts<'_>,
    args: &[StaticSyntaxValue],
) -> Option<Value> {
    let base_storage = args.first().and_then(direct_identifier);
    let prefix = args.get(1).and_then(|value| string_value(value, context));
    if base_storage.is_none() && prefix.is_none() {
        return None;
    }
    let id = format!("storage.scope:{}", safe_id(parts.variable_name));
    let references = base_storage
        .as_deref()
        .map(|to_variable| json!({ "type": "storage.scope.wraps_storage", "toVariable": to_variable }))
        .into_iter()
        .collect();
    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "storage.scope",
            name: parts.variable_name.to_string(),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata: scope_metadata(
                parts.variable_name,
                base_storage.as_deref(),
                prefix.as_deref(),
            ),
        }),
        Vec::new(),
        references,
        Vec::new(),
    ))
}

fn storage_factory_definition(
    context: &PrimitiveContext<'_>,
    parts: &StorageParts<'_>,
    descriptor: StorageFactoryDescriptor,
) -> Value {
    static_index_definition(NativeDefinitionInput {
        id: format!("{}:{}", descriptor.kind, safe_id(parts.variable_name)),
        kind: descriptor.kind,
        name: parts.variable_name.to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata: factory_metadata(parts.variable_name, descriptor),
    })
}

fn bundle_relation_refs(refs: &StorageReferences) -> Vec<Value> {
    storage_relation_refs("storage.bundle", refs)
        .into_iter()
        .filter(|reference| {
            reference
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|relation_type| relation_type != "storage.bundle.uses_storage")
        })
        .collect()
}

fn has_bundle_fields(config: &StaticSyntaxValue) -> bool {
    has_property(config, "records")
        || has_property(config, "vectors")
        || has_property(config, "assets")
}

fn string_value(value: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<String> {
    match resolve_static_value(value, &context.initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}
