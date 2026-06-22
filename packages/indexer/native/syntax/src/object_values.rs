use std::collections::HashMap;

use oxc_ast::ast::*;

use crate::{
    protocol::{StaticImportRecord, StaticObjectProperty, StaticSyntaxValue},
    source::SourceView,
    values::{expression_name, syntax_value_from_expression},
};

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

pub(crate) fn object_value(
    view: &SourceView<'_>,
    object: &ObjectExpression<'_>,
    imports: &ImportsByLocalName,
) -> StaticSyntaxValue {
    StaticSyntaxValue::Object {
        properties: object
            .properties
            .iter()
            .filter_map(|property| object_property(view, property, imports))
            .collect(),
        source: view.location_for_span(object),
        snippet: Some(view.snippet_for_span(object)),
    }
}

pub(crate) fn property_access_value(member: &StaticMemberExpression<'_>) -> StaticSyntaxValue {
    let path = member_expression_path(member);
    StaticSyntaxValue::PropertyAccess {
        name: path.last().cloned().unwrap_or_default(),
        path,
    }
}

fn object_property(
    view: &SourceView<'_>,
    property: &ObjectPropertyKind<'_>,
    imports: &ImportsByLocalName,
) -> Option<StaticObjectProperty> {
    match property {
        ObjectPropertyKind::SpreadProperty(spread) => {
            let name = expression_name(&spread.argument)?;
            Some(StaticObjectProperty {
                name,
                value: syntax_value_from_expression(view, &spread.argument, imports),
                shorthand: false,
                spread: Some(true),
                source: view.location_for_span(&**spread),
            })
        }
        ObjectPropertyKind::ObjectProperty(property) => Some(StaticObjectProperty {
            name: property_name(&property.key)?,
            value: syntax_value_from_expression(view, &property.value, imports),
            shorthand: property.shorthand,
            spread: None,
            source: view.location_for_span(&**property),
        }),
    }
}

fn property_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
        PropertyKey::NumericLiteral(literal) => Some(number_to_string(literal.value)),
        _ => None,
    }
}

fn member_expression_path(member: &StaticMemberExpression<'_>) -> Vec<String> {
    let mut names = vec![member.property.name.as_str().to_string()];
    let mut current = &member.object;
    loop {
        match current {
            Expression::StaticMemberExpression(parent) => {
                names.insert(0, parent.property.name.as_str().to_string());
                current = &parent.object;
            }
            Expression::Identifier(identifier) => {
                names.insert(0, identifier.name.as_str().to_string());
                return names;
            }
            _ => return names,
        }
    }
}

fn number_to_string(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}
