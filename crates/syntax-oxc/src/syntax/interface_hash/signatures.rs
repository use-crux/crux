use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::text::{surface_text, type_annotation_text, type_parameters_text};

pub(super) fn initializer_interface(source: &str, expression: &Expression<'_>) -> String {
    match expression {
        Expression::ArrowFunctionExpression(function) => arrow_function_signature(source, function),
        Expression::FunctionExpression(function) => function_signature(source, function),
        Expression::ClassExpression(class) => class_signature(source, class),
        _ => surface_text(source, expression.span()),
    }
}

pub(super) fn function_signature(source: &str, function: &Function<'_>) -> String {
    [
        function
            .type_parameters
            .as_ref()
            .map(|parameters| type_parameters_text(source, parameters.span))
            .unwrap_or_default(),
        parameters(source, &function.params),
        function
            .return_type
            .as_ref()
            .map(|annotation| type_annotation_text(source, annotation.span))
            .unwrap_or_default(),
    ]
    .join(":")
}

fn arrow_function_signature(source: &str, function: &ArrowFunctionExpression<'_>) -> String {
    [
        function
            .type_parameters
            .as_ref()
            .map(|parameters| type_parameters_text(source, parameters.span))
            .unwrap_or_default(),
        parameters(source, &function.params),
        function
            .return_type
            .as_ref()
            .map(|annotation| type_annotation_text(source, annotation.span))
            .unwrap_or_default(),
    ]
    .join(":")
}

pub(super) fn class_signature(source: &str, class: &Class<'_>) -> String {
    let mut heritage = Vec::new();
    if let Some(super_class) = &class.super_class {
        let mut value = format!("extends {}", surface_text(source, super_class.span()));
        if let Some(type_arguments) = &class.super_type_arguments {
            value.push_str(&surface_text(source, type_arguments.span));
        }
        heritage.push(value);
    }
    for item in &class.implements {
        heritage.push(format!("implements {}", surface_text(source, item.span)));
    }
    let mut members = class
        .body
        .body
        .iter()
        .filter_map(|member| class_member_signature(source, member))
        .collect::<Vec<_>>();
    members.sort();
    [heritage.join("|"), members.join(":")].join(":")
}

fn class_member_signature(source: &str, member: &ClassElement<'_>) -> Option<String> {
    match member {
        ClassElement::MethodDefinition(method) => {
            if method.accessibility == Some(TSAccessibility::Private) {
                return None;
            }
            Some(format!(
                "method:{}:{}",
                property_key_name(source, &method.key),
                function_signature(source, &method.value)
            ))
        }
        ClassElement::PropertyDefinition(property) => {
            if property.accessibility == Some(TSAccessibility::Private) {
                return None;
            }
            Some(format!(
                "property:{}:{}:{}",
                property_key_name(source, &property.key),
                property
                    .type_annotation
                    .as_ref()
                    .map(|annotation| type_annotation_text(source, annotation.span))
                    .unwrap_or_default(),
                property
                    .value
                    .as_ref()
                    .map(|value| initializer_interface(source, value))
                    .unwrap_or_default()
            ))
        }
        ClassElement::AccessorProperty(accessor) => {
            if accessor.accessibility == Some(TSAccessibility::Private) {
                return None;
            }
            Some(format!(
                "accessor:{}:{}",
                property_key_name(source, &accessor.key),
                accessor
                    .type_annotation
                    .as_ref()
                    .map(|annotation| type_annotation_text(source, annotation.span))
                    .unwrap_or_default()
            ))
        }
        _ => Some(surface_text(source, member.span())),
    }
}

fn parameters(source: &str, parameters: &FormalParameters<'_>) -> String {
    let mut rows = parameters
        .items
        .iter()
        .map(|parameter| {
            [
                binding_pattern_text(source, &parameter.pattern),
                if parameter.optional { "?" } else { "" }.to_string(),
                parameter
                    .type_annotation
                    .as_ref()
                    .map(|annotation| type_annotation_text(source, annotation.span))
                    .unwrap_or_default(),
                parameter
                    .initializer
                    .as_ref()
                    .map(|initializer| initializer_interface(source, initializer))
                    .unwrap_or_default(),
            ]
            .join("")
        })
        .collect::<Vec<_>>();
    if let Some(rest) = &parameters.rest {
        rows.push(format!(
            "...{}{}",
            binding_pattern_text(source, &rest.rest.argument),
            rest.type_annotation
                .as_ref()
                .map(|annotation| type_annotation_text(source, annotation.span))
                .unwrap_or_default()
        ));
    }
    rows.join(",")
}

pub(super) fn binding_names(pattern: &BindingPattern<'_>) -> Vec<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => vec![identifier.name.as_str().to_string()],
        BindingPattern::ObjectPattern(pattern) => {
            let mut names = pattern
                .properties
                .iter()
                .flat_map(|property| binding_names(&property.value))
                .collect::<Vec<_>>();
            if let Some(rest) = &pattern.rest {
                names.extend(binding_names(&rest.argument));
            }
            names
        }
        BindingPattern::ArrayPattern(pattern) => {
            let mut names = pattern
                .elements
                .iter()
                .filter_map(|element| element.as_ref())
                .flat_map(binding_names)
                .collect::<Vec<_>>();
            if let Some(rest) = &pattern.rest {
                names.extend(binding_names(&rest.argument));
            }
            names
        }
        BindingPattern::AssignmentPattern(pattern) => binding_names(&pattern.left),
    }
}

fn binding_pattern_text(source: &str, pattern: &BindingPattern<'_>) -> String {
    surface_text(source, pattern.span())
}

fn property_key_name(source: &str, key: &PropertyKey<'_>) -> String {
    match key {
        PropertyKey::StaticIdentifier(identifier) => identifier.name.as_str().to_string(),
        PropertyKey::PrivateIdentifier(identifier) => format!("#{}", identifier.name.as_str()),
        _ => surface_text(source, key.span()),
    }
}
