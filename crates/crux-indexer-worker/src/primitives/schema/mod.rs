use std::collections::HashSet;

use serde_json::{Map, Value};

pub(crate) mod common;
pub(crate) mod convex;
pub(crate) mod zod;

use crate::{
    primitives::record_values::property_value,
    primitives::routing::model::RoutingContext,
    primitives::schema::common::{child_values, contains_root_namespace},
    primitives::schema::convex::convex_value_to_json_schema,
    primitives::schema::zod::zod_value_to_json_schema,
    primitives::source_refs::schema_source_ref,
    protocol::StaticSyntaxValue,
};

pub(crate) struct SchemaProjection {
    pub schema: Option<Value>,
    pub source_refs: Vec<Value>,
}

/// Projects a config property into JSON Schema and matching schema source refs.
pub(crate) fn schema_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
) -> Option<SchemaProjection> {
    let value = property_value(object, property);
    let resolved = context.resolve_record_source(value)?;
    let schema = syntax_value_to_json_schema(value, context);
    let resolved_schema = resolved
        .as_ref()
        .and_then(|source| syntax_value_to_json_schema(Some(source.value), context));
    let final_schema = schema.or(resolved_schema);
    let mut source_refs = Vec::new();

    if let Some(resolved) = resolved.as_ref() {
        source_refs.push(schema_source_ref(
            definition_id,
            property,
            resolved,
            schema_metadata(resolved.value, final_schema.is_some(), false),
        ));
        source_refs.extend(nested_schema_source_refs(
            context,
            definition_id,
            property,
            resolved.value,
            &resolved.symbol,
        )?);
    }

    Some(SchemaProjection {
        schema: final_schema,
        source_refs,
    })
}

/// Projects a syntax-record value into JSON Schema when it matches a supported schema DSL.
pub(crate) fn syntax_value_to_json_schema(
    value: Option<&StaticSyntaxValue>,
    context: &RoutingContext<'_>,
) -> Option<Value> {
    zod_value_to_json_schema(value, context, &mut HashSet::new())
        .or_else(|| convex_value_to_json_schema(value, context, &mut HashSet::new()))
}

fn nested_schema_source_refs(
    context: &RoutingContext<'_>,
    definition_id: &str,
    property: &str,
    root: &StaticSyntaxValue,
    root_symbol: &str,
) -> Option<Vec<Value>> {
    let mut refs = Vec::new();
    let mut seen = HashSet::from([root_symbol.to_string()]);
    visit_nested_schema_value(context, definition_id, property, root, &mut seen, &mut refs)?;
    Some(refs)
}

fn visit_nested_schema_value(
    context: &RoutingContext<'_>,
    definition_id: &str,
    property: &str,
    value: &StaticSyntaxValue,
    seen: &mut HashSet<String>,
    refs: &mut Vec<Value>,
) -> Option<()> {
    if let StaticSyntaxValue::Identifier { .. } = value {
        let Some(resolved) = context.resolve_record_source(Some(value))? else {
            return Some(());
        };
        if seen.insert(resolved.symbol.clone()) && schema_kind(resolved.value).is_some() {
            refs.push(schema_source_ref(
                definition_id,
                property,
                &resolved,
                schema_metadata(
                    resolved.value,
                    syntax_value_to_json_schema(Some(resolved.value), context).is_some(),
                    true,
                ),
            ));
            visit_nested_schema_value(
                context,
                definition_id,
                property,
                resolved.value,
                seen,
                refs,
            )?;
        }
        return Some(());
    }

    for child in child_values(value) {
        visit_nested_schema_value(context, definition_id, property, child, seen, refs)?;
    }
    Some(())
}

fn schema_metadata(value: &StaticSyntaxValue, parsed_schema: bool, nested: bool) -> Value {
    let mut metadata = Map::new();
    if let Some(kind) = schema_kind(value) {
        metadata.insert("schemaKind".to_string(), Value::String(kind.to_string()));
    }
    metadata.insert("parsedSchema".to_string(), Value::Bool(parsed_schema));
    if nested {
        metadata.insert("nested".to_string(), Value::Bool(true));
    }
    Value::Object(metadata)
}

fn schema_kind(value: &StaticSyntaxValue) -> Option<&'static str> {
    if contains_root_namespace(value, "z") {
        return Some("zod");
    }
    if contains_root_namespace(value, "v") {
        return Some("convex-validator");
    }
    matches!(value, StaticSyntaxValue::Object { .. }).then_some("json-schema")
}
