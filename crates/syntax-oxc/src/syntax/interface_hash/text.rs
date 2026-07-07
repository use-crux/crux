use oxc_span::Span;

pub(super) fn type_annotation_text(source: &str, span: Span) -> String {
    surface_text(source, span)
        .trim_start_matches(':')
        .trim()
        .to_string()
}

pub(super) fn type_parameters_text(source: &str, span: Span) -> String {
    let text = surface_text(source, span);
    let trimmed = text.trim();
    if trimmed.starts_with('<') && trimmed.ends_with('>') {
        trimmed[1..trimmed.len().saturating_sub(1)]
            .trim()
            .to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn surface_text(source: &str, span: Span) -> String {
    let start = span.start as usize;
    let end = span.end as usize;
    let raw = source.get(start..end).unwrap_or_default();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}
