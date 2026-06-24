//! Source-ref helpers for native routing-style fact projectors.

use serde_json::Value;

use crate::{
    native_definition::source_ref, native_record_values::property_value,
    native_routing_model::RoutingContext, protocol::StaticSyntaxValue,
};

pub(crate) fn source_ref_for_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<Value>> {
    source_ref_for_callback_property(context, definition_id, object, property, "callback")
}

pub(crate) fn source_ref_for_callback_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    role: &str,
) -> Option<Option<Value>> {
    source_ref_for_resolved_property(context, definition_id, object, property, role, true)
}

pub(crate) fn source_ref_for_static_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    role: &str,
) -> Option<Option<Value>> {
    source_ref_for_resolved_property(context, definition_id, object, property, role, false)
}

fn source_ref_for_resolved_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    role: &str,
    require_function: bool,
) -> Option<Option<Value>> {
    let Some(resolved) = context.resolve_record_source(property_value(object, property))? else {
        return Some(None);
    };
    if require_function && !matches!(resolved.value, StaticSyntaxValue::Function { .. }) {
        return Some(None);
    }
    Some(Some(source_ref(
        definition_id,
        role,
        property,
        &resolved.symbol,
        &resolved.source,
        resolved.function_name.as_deref(),
        resolved.snippet.as_ref(),
    )))
}
