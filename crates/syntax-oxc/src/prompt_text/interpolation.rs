use crux_indexer_protocol::prompt_text::PromptTextInterpolationBarrier;
use oxc_ast::ast::Expression;
use oxc_span::{GetSpan, Span};

use super::mapping::SourceMap;

pub(crate) fn barriers(
    map: &SourceMap<'_>,
    quasis: &[Span],
    expressions: &[Expression<'_>],
) -> Vec<PromptTextInterpolationBarrier> {
    expressions
        .iter()
        .enumerate()
        .filter_map(|(index, expression)| {
            let left = quasis.get(index)?;
            let right = quasis.get(index + 1)?;
            Some(PromptTextInterpolationBarrier {
                index: index as u32,
                range: map.bytes(left.end as usize..right.start as usize),
                expression_range: map.span(expression.span()),
                line_isolation_edit: None,
            })
        })
        .collect()
}
