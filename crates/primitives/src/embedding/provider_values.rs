use serde_json::Value;

use crate::{
    context::PrimitiveContext,
    embedding::core_values::{KnownTaskValue, known_task_value},
    protocol::StaticSyntaxValue,
    record_values::{direct_string_property, json_value, number_property, property_value},
};

pub(crate) fn required_string(
    config: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<String>> {
    property_value(config, property).map(|_| direct_string_property(config, property))
}

pub(crate) fn default_string(
    config: &StaticSyntaxValue,
    property: &str,
    fallback: Option<String>,
) -> Option<Option<String>> {
    if property_value(config, property).is_some() {
        required_string(config, property)
    } else {
        Some(fallback)
    }
}

pub(crate) fn required_number(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<f64>> {
    property_value(config, property)
        .map(|_| number_property(config, property, &context.initializers))
}

pub(crate) fn default_number(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    property: &str,
    fallback: Option<f64>,
) -> Option<Option<f64>> {
    if property_value(config, property).is_some() {
        required_number(context, config, property)
    } else {
        Some(fallback)
    }
}

pub(crate) fn optional_string(
    config: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<String>> {
    if property_value(config, property).is_some() {
        required_string(config, property)
    } else {
        Some(None)
    }
}

pub(crate) fn optional_boolean(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<Value>> {
    match property_value(config, property) {
        Some(value) => {
            let value = json_value(value, &context.initializers)?;
            value.is_boolean().then_some(Some(value))
        }
        None => Some(None),
    }
}

pub(crate) fn optional_tasks(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<Option<KnownTaskValue>> {
    match property_value(config, "tasks") {
        Some(value) => known_task_value(value, context).map(Some),
        None => Some(None),
    }
}
