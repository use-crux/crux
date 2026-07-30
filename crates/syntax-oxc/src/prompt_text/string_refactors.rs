use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextLimits, PromptTextRefactorAnalysis,
    PromptTextRefactorProof, PromptTextRefactorProofLevel,
};
use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectProperty, PropertyKey, PropertyKind, Statement},
};
use oxc_parser::Parser;
use oxc_semantic::Semantic;
use oxc_span::{GetSpan, SourceType, Span};

use super::{cooked, mapping::SourceMap, normalization};

pub(crate) fn project(
    source: &str,
    source_type: SourceType,
    semantic: &Semantic<'_>,
    limits: &PromptTextLimits,
    map: &SourceMap<'_>,
) -> PromptTextRefactorAnalysis {
    let mut properties = semantic
        .nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::ObjectProperty(property) if syntactic_candidate(property) => Some(property),
            _ => None,
        })
        .collect::<Vec<_>>();
    properties.sort_by_key(|property| property.value.span().start);
    properties.dedup_by_key(|property| property.value.span());

    let mut status = if properties.len() > limits.max_string_refactors as usize {
        PromptTextAnalysisStatus::Truncated
    } else {
        PromptTextAnalysisStatus::Complete
    };
    properties.truncate(limits.max_string_refactors as usize);
    let mut proofs = Vec::new();
    let mut output_bytes = 0usize;
    for (candidate_id, property) in properties.into_iter().enumerate() {
        let span = literal_span(transparent(&property.value))
            .expect("syntactic candidates have a direct literal");
        if span.size() as usize > limits.max_string_refactor_bytes as usize {
            status = PromptTextAnalysisStatus::Truncated;
            break;
        }
        let Some(proof) = prove_candidate(
            source,
            source_type,
            map,
            candidate_id as u32,
            &property.value,
        ) else {
            continue;
        };
        let encoded = serde_json::to_vec(&proof).expect("refactor proof serializes");
        let separator = usize::from(!proofs.is_empty());
        if output_bytes
            .checked_add(separator)
            .and_then(|bytes| bytes.checked_add(encoded.len()))
            .is_none_or(|bytes| bytes > limits.max_string_refactor_output_bytes as usize)
        {
            status = PromptTextAnalysisStatus::Truncated;
            break;
        }
        output_bytes += separator + encoded.len();
        proofs.push(proof);
    }
    PromptTextRefactorAnalysis { status, proofs }
}

fn syntactic_candidate(property: &ObjectProperty<'_>) -> bool {
    property.kind == PropertyKind::Init
        && !property.method
        && !property.shorthand
        && !property.computed
        && matches!(property_name(&property.key), Some("prompt" | "system"))
        && literal_span(transparent(&property.value)).is_some()
}

fn prove_candidate(
    source: &str,
    source_type: SourceType,
    map: &SourceMap<'_>,
    candidate_id: u32,
    expression: &Expression<'_>,
) -> Option<PromptTextRefactorProof> {
    let expression = transparent(expression);
    let (span, value, original_template) = literal(expression)?;
    if !value.contains('\n') || normalization::scalar(&value)? != value {
        return None;
    }
    let expected_text = source
        .get(span.start as usize..span.end as usize)?
        .to_owned();
    let template_text = if original_template {
        expected_text.clone()
    } else {
        quoted_template(source, span, &value)
    };
    let reconstructed = reparse_template(source_type, &template_text)?;
    if reconstructed.as_bytes() != value.as_bytes()
        || !reconstructed.encode_utf16().eq(value.encode_utf16())
        || normalization::scalar(&reconstructed)? != value
    {
        return None;
    }
    Some(PromptTextRefactorProof::OrdinaryStringToMd {
        candidate_id,
        range: map.span(span),
        expected_text,
        template_text,
        proof: PromptTextRefactorProofLevel::SyntaxExact,
    })
}

fn literal(expression: &Expression<'_>) -> Option<(Span, String, bool)> {
    match expression {
        Expression::StringLiteral(value) if !value.lone_surrogates => {
            Some((value.span, value.value.as_str().to_owned(), false))
        }
        Expression::TemplateLiteral(value) if value.expressions.is_empty() => {
            let quasi = value.quasis.first()?;
            let cooked = quasi.value.cooked.as_ref()?.as_str();
            (!quasi.lone_surrogates).then(|| (value.span, cooked.to_owned(), true))
        }
        _ => None,
    }
}

fn literal_span(expression: &Expression<'_>) -> Option<Span> {
    match expression {
        Expression::StringLiteral(value) => Some(value.span),
        Expression::TemplateLiteral(value) => Some(value.span),
        _ => None,
    }
}

fn transparent<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    while let Expression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}

fn property_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(value) => Some(value.name.as_str()),
        PropertyKey::Identifier(value) => Some(value.name.as_str()),
        PropertyKey::StringLiteral(value) if !value.lone_surrogates => Some(value.value.as_str()),
        _ => None,
    }
}

fn quoted_template(source: &str, span: Span, value: &str) -> String {
    let eol = local_eol(source, span);
    let indent = carrier_indent(source, span.start as usize);
    let mut result = String::from("`");
    result.push_str(eol);
    result.push_str(indent);
    encode_value(&mut result, value, eol, indent);
    result.push_str(eol);
    result.push_str(indent);
    result.push('`');
    result
}

fn local_eol(source: &str, span: Span) -> &'static str {
    if let Some(index) = source[..span.start as usize].rfind('\n') {
        return if index > 0 && source.as_bytes()[index - 1] == b'\r' {
            "\r\n"
        } else {
            "\n"
        };
    }
    source[span.end as usize..]
        .find('\n')
        .map(|offset| span.end as usize + offset)
        .map_or("\n", |index| {
            if index > 0 && source.as_bytes()[index - 1] == b'\r' {
                "\r\n"
            } else {
                "\n"
            }
        })
}

fn carrier_indent(source: &str, start: usize) -> &str {
    let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
    let line = &source[line_start..start];
    let length = line
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    &line[..length]
}

fn encode_value(result: &mut String, value: &str, eol: &str, indent: &str) {
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\n' => {
                result.push_str(eol);
                result.push_str(indent);
            }
            '\r' => result.push_str("\\r"),
            '\\' => result.push_str("\\\\"),
            '`' => result.push_str("\\`"),
            '$' if characters.peek() == Some(&'{') => result.push_str("\\$"),
            '\t' => result.push_str("\\t"),
            '\0'..='\u{001f}' | '\u{007f}' => {
                use std::fmt::Write;
                write!(result, "\\x{:02X}", character as u32).expect("String write cannot fail");
            }
            '\u{2028}' => result.push_str("\\u2028"),
            '\u{2029}' => result.push_str("\\u2029"),
            _ => result.push(character),
        }
    }
}

fn reparse_template(source_type: SourceType, template: &str) -> Option<String> {
    let source = format!("const __crux = {template};");
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, source_type).parse();
    if parsed.panicked {
        return None;
    }
    let statement = parsed.program.body.first()?;
    let Statement::VariableDeclaration(declaration) = statement else {
        return None;
    };
    let expression = declaration.declarations.first()?.init.as_ref()?;
    let Expression::TemplateLiteral(template) = expression else {
        return None;
    };
    if !template.expressions.is_empty() {
        return None;
    }
    let quasi = template.quasis.first()?;
    let island = cooked::island(&source, 0, quasi)?;
    normalization::scalar(&island.text)
}
