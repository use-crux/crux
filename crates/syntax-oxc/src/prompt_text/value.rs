use oxc_ast::ast::{
    Argument, ArrayExpressionElement, Expression, ObjectPropertyKind, PropertyKey, PropertyKind,
};
use oxc_semantic::{Scoping, SymbolId};
use oxc_syntax::{number::ToJsString, operator::UnaryOperator};

use super::cooked;
use super::fragments::FragmentIndex;

/// Closed syntax-exact value retained for static preview rendering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectedValue {
    Scalar(String),
    Omitted,
    Sequence(Vec<ProjectedSequenceItem>),
    Json(ProjectedJsonValue),
    Fragment { candidate_id: u32 },
    SemanticFragment { fragment: u32 },
    Unknown,
}

/// One authored array slot retained with its interpolation path component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedSequenceItem {
    pub index: u32,
    pub value: ProjectedValue,
}

/// Closed inert JSON tree accepted by direct receiver-matching `tag.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectedJsonValue {
    Null,
    Boolean(bool),
    String(String),
    Number(String),
    Array(Vec<ProjectedJsonValue>),
    Object(Vec<(String, ProjectedJsonValue)>),
    Undefined,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TagBinding {
    root: TagRoot,
    properties: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TagRoot {
    Symbol(SymbolId),
    Unresolved(String),
}

pub(crate) fn project(
    source: &str,
    expression: &Expression<'_>,
    scoping: &Scoping,
    tag_binding: Option<&TagBinding>,
    fragments: &FragmentIndex,
) -> ProjectedValue {
    let expression = transparent(expression);
    match expression {
        Expression::StringLiteral(literal) if !literal.lone_surrogates => {
            ProjectedValue::Scalar(literal.value.as_str().to_owned())
        }
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| cooked::island(source, 0, quasi))
            .map_or(ProjectedValue::Unknown, |island| {
                ProjectedValue::Scalar(island.text)
            }),
        Expression::NumericLiteral(literal) if literal.value.is_finite() => {
            ProjectedValue::Scalar(literal.value.to_js_string())
        }
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::UnaryNegation
                && matches!(transparent(&unary.argument), Expression::NumericLiteral(_)) =>
        {
            let Expression::NumericLiteral(literal) = transparent(&unary.argument) else {
                unreachable!("guard requires a numeric literal");
            };
            let value = -literal.value;
            if value.is_finite() {
                ProjectedValue::Scalar(value.to_js_string())
            } else {
                ProjectedValue::Unknown
            }
        }
        Expression::BooleanLiteral(literal) if !literal.value => ProjectedValue::Omitted,
        Expression::NullLiteral(_) => ProjectedValue::Omitted,
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && identifier
                    .reference_id
                    .get()
                    .is_some_and(|id| scoping.get_reference(id).symbol_id().is_none()) =>
        {
            ProjectedValue::Omitted
        }
        Expression::ArrayExpression(array) => ProjectedValue::Sequence(
            array
                .elements
                .iter()
                .enumerate()
                .map(|(index, element)| ProjectedSequenceItem {
                    index: index as u32,
                    value: match element {
                        oxc_ast::ast::ArrayExpressionElement::Elision(_) => ProjectedValue::Omitted,
                        oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => {
                            ProjectedValue::Unknown
                        }
                        element => element
                            .as_expression()
                            .map_or(ProjectedValue::Unknown, |value| {
                                project(source, value, scoping, tag_binding, fragments)
                            }),
                    },
                })
                .collect(),
        ),
        Expression::CallExpression(call) => project_json_call(call, scoping, tag_binding)
            .map_or(ProjectedValue::Unknown, ProjectedValue::Json),
        expression => fragments
            .resolve(expression, tag_binding, scoping)
            .map_or(ProjectedValue::Unknown, |candidate_id| {
                ProjectedValue::Fragment { candidate_id }
            }),
    }
}

pub(crate) fn binding(expression: &Expression<'_>, scoping: &Scoping) -> Option<TagBinding> {
    match transparent(expression) {
        Expression::Identifier(identifier) => {
            let reference = identifier.reference_id.get()?;
            let reference = scoping.get_reference(reference);
            Some(TagBinding {
                root: reference.symbol_id().map_or_else(
                    || TagRoot::Unresolved(identifier.name.to_string()),
                    TagRoot::Symbol,
                ),
                properties: Vec::new(),
            })
        }
        Expression::StaticMemberExpression(member) => {
            let mut identity = binding(&member.object, scoping)?;
            identity.properties.push(member.property.name.to_string());
            Some(identity)
        }
        _ => None,
    }
}

fn project_json_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    scoping: &Scoping,
    tag_binding: Option<&TagBinding>,
) -> Option<ProjectedJsonValue> {
    let expected = tag_binding?;
    let Expression::StaticMemberExpression(member) = transparent(&call.callee) else {
        return None;
    };
    if member.property.name != "json" || binding(&member.object, scoping).as_ref() != Some(expected)
    {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    json_argument(argument, scoping)
}

fn json_argument(argument: &Argument<'_>, scoping: &Scoping) -> Option<ProjectedJsonValue> {
    argument
        .as_expression()
        .and_then(|expression| json_value(expression, scoping))
        .and_then(|value| (value != ProjectedJsonValue::Undefined).then_some(value))
}

fn json_value(expression: &Expression<'_>, scoping: &Scoping) -> Option<ProjectedJsonValue> {
    match transparent(expression) {
        Expression::StringLiteral(literal) if !literal.lone_surrogates => Some(
            ProjectedJsonValue::String(literal.value.as_str().to_owned()),
        ),
        Expression::NumericLiteral(literal) => Some(json_number(literal.value)),
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::UnaryNegation
                && matches!(transparent(&unary.argument), Expression::NumericLiteral(_)) =>
        {
            let Expression::NumericLiteral(literal) = transparent(&unary.argument) else {
                unreachable!("guard requires a numeric literal");
            };
            Some(json_number(-literal.value))
        }
        Expression::BooleanLiteral(literal) => Some(ProjectedJsonValue::Boolean(literal.value)),
        Expression::NullLiteral(_) => Some(ProjectedJsonValue::Null),
        Expression::Identifier(identifier) if unbound_undefined(identifier, scoping) => {
            Some(ProjectedJsonValue::Undefined)
        }
        Expression::ArrayExpression(array) => {
            let mut values = Vec::with_capacity(array.elements.len());
            for element in &array.elements {
                let value = match element {
                    ArrayExpressionElement::Elision(_) => ProjectedJsonValue::Null,
                    ArrayExpressionElement::SpreadElement(_) => return None,
                    element => match json_value(element.as_expression()?, scoping)? {
                        ProjectedJsonValue::Undefined => ProjectedJsonValue::Null,
                        value => value,
                    },
                };
                values.push(value);
            }
            Some(ProjectedJsonValue::Array(values))
        }
        Expression::ObjectExpression(object) => {
            let mut values = Vec::<(String, ProjectedJsonValue)>::new();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.kind != PropertyKind::Init
                    || property.method
                    || property.shorthand
                    || property.computed
                {
                    return None;
                }
                let key = json_property_name(&property.key)?;
                if key == "__proto__" {
                    return None;
                }
                let value = json_value(&property.value, scoping)?;
                if let Some((_, retained)) = values.iter_mut().find(|(name, _)| *name == key) {
                    *retained = value;
                } else {
                    values.push((key, value));
                }
            }
            values.retain(|(_, value)| *value != ProjectedJsonValue::Undefined);
            Some(ProjectedJsonValue::Object(values))
        }
        _ => None,
    }
}

fn json_number(value: f64) -> ProjectedJsonValue {
    if value.is_finite() {
        ProjectedJsonValue::Number(value.to_js_string())
    } else {
        ProjectedJsonValue::Null
    }
}

fn json_property_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(literal) if !literal.lone_surrogates => {
            Some(literal.value.as_str().to_owned())
        }
        PropertyKey::NumericLiteral(literal) => Some(literal.value.to_js_string()),
        _ => None,
    }
}

fn unbound_undefined(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    scoping: &Scoping,
) -> bool {
    identifier.name == "undefined"
        && identifier
            .reference_id
            .get()
            .is_some_and(|id| scoping.get_reference(id).symbol_id().is_none())
}

pub(super) fn transparent<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    match expression {
        Expression::ParenthesizedExpression(value) => transparent(&value.expression),
        Expression::TSAsExpression(value) => transparent(&value.expression),
        Expression::TSSatisfiesExpression(value) => transparent(&value.expression),
        Expression::TSTypeAssertion(value) => transparent(&value.expression),
        Expression::TSNonNullExpression(value) => transparent(&value.expression),
        _ => expression,
    }
}
