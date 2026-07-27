use crux_indexer_protocol::prompt_text::PromptTextPreviewSegment;
use crux_indexer_syntax_oxc::prompt_text::{
    ProjectedPromptTextTemplate, ProjectedTextIsland, map_projected_range,
};

pub(super) enum Part {
    Literal(PromptTextPreviewSegment),
    Interpolation(usize),
}

#[derive(Default)]
pub(super) struct Line {
    pub(super) parts: Vec<Part>,
    pub(super) newline: Option<PromptTextPreviewSegment>,
}

pub(super) fn lines(source: &str, projected: &ProjectedPromptTextTemplate) -> Vec<Line> {
    let mut lines = vec![Line::default()];
    for (index, island) in projected.islands.iter().enumerate() {
        append_island(source, island, &mut lines);
        if index < projected.interpolations.len() {
            lines
                .last_mut()
                .expect("line exists")
                .parts
                .push(Part::Interpolation(index));
        }
    }
    lines
}

fn append_island(source: &str, island: &ProjectedTextIsland, lines: &mut Vec<Line>) {
    let mut start = 0;
    for (newline, _) in island.text.match_indices('\n') {
        append_literal(
            source,
            island,
            start..newline,
            lines.last_mut().expect("line exists"),
        );
        lines.last_mut().expect("line exists").newline =
            literal(source, island, newline..newline + 1);
        lines.push(Line::default());
        start = newline + 1;
    }
    append_literal(
        source,
        island,
        start..island.text.len(),
        lines.last_mut().expect("line exists"),
    );
}

fn append_literal(
    source: &str,
    island: &ProjectedTextIsland,
    range: std::ops::Range<usize>,
    line: &mut Line,
) {
    if let Some(segment) = literal(source, island, range) {
        line.parts.push(Part::Literal(segment));
    }
}

fn literal(
    source: &str,
    island: &ProjectedTextIsland,
    range: std::ops::Range<usize>,
) -> Option<PromptTextPreviewSegment> {
    if range.is_empty() {
        return None;
    }
    Some(PromptTextPreviewSegment::AuthoredLiteral {
        text: island.text[range.clone()].to_owned(),
        range: map_projected_range(source, island, range)?,
    })
}
