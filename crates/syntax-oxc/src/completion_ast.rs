//! Small AST readers shared by completion classification and exclusion.

use oxc_ast::ast::*;

pub(crate) fn member_expressions<'ast>(
    expression: &'ast Expression<'ast>,
) -> Vec<&'ast Expression<'ast>> {
    match expression {
        Expression::ObjectExpression(object) => object
            .properties
            .iter()
            .filter_map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => Some(&property.value),
                ObjectPropertyKind::SpreadProperty(_) => None,
            })
            .collect(),
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn property_expression<'ast>(
    expression: &'ast Expression<'ast>,
    name: &str,
) -> Option<&'ast Expression<'ast>> {
    let Expression::ObjectExpression(object) = expression else {
        return None;
    };
    object
        .properties
        .iter()
        .find_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property)
                if property_name(&property.key).as_deref() == Some(name) =>
            {
                Some(&property.value)
            }
            _ => None,
        })
}

pub(crate) fn property_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
        _ => None,
    }
}
