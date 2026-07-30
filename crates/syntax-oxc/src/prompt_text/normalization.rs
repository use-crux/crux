use std::ops::Range;

use super::{cooked::CookedIsland, mapping::ByteMapping, projection::ProjectedTextIsland};

#[derive(Debug)]
enum Part {
    Literal { island: usize, range: Range<usize> },
    Barrier,
}

#[derive(Debug, Default)]
struct Line {
    parts: Vec<Part>,
    newline: Option<(usize, Range<usize>)>,
}

/// Applies Core's construction-time outer-line and common-indent rules.
pub(crate) fn normalize(islands: Vec<CookedIsland>) -> Option<Vec<ProjectedTextIsland>> {
    let lines = logical_lines(&islands);
    let start = lines
        .iter()
        .position(|line| !authored_blank(line, &islands))
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !authored_blank(line, &islands))
        .map_or(start, |index| index + 1);
    let kept = &lines[start..end];
    let indent = common_indent(kept, &islands);
    let mut retained = vec![Vec::<Range<usize>>::new(); islands.len()];

    for (line_index, line) in kept.iter().enumerate() {
        for (part_index, part) in line.parts.iter().enumerate() {
            let Part::Literal { island, range } = part else {
                continue;
            };
            let start =
                if part_index == 0 && islands[*island].text[range.clone()].starts_with(&indent) {
                    range.start + indent.len()
                } else {
                    range.start
                };
            if start < range.end {
                retained[*island].push(start..range.end);
            }
        }
        if line_index + 1 < kept.len()
            && let Some((island, newline)) = &line.newline
        {
            retained[*island].push(newline.clone());
        }
    }

    islands
        .into_iter()
        .zip(retained)
        .map(|(island, ranges)| rebuild(island, &ranges))
        .collect()
}

/// Applies the same Core construction-time whitespace rules to one scalar
/// interpolation-free value. Refactor proofs use this to require a fixed
/// point before and after encoding.
pub(crate) fn scalar(value: &str) -> Option<String> {
    let lines = value.split('\n').collect::<Vec<_>>();
    let start = lines
        .iter()
        .position(|line| !blank_text(line))
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !blank_text(line))
        .map_or(start, |index| index + 1);
    let kept = &lines[start..end];
    if kept.is_empty() {
        return Some(String::new());
    }
    let indent = kept
        .iter()
        .filter(|line| !blank_text(line))
        .map(|line| &line[..leading_text_indent(line)])
        .reduce(common_text_prefix)
        .unwrap_or("");
    Some(
        kept.iter()
            .map(|line| line.strip_prefix(indent).unwrap_or(line))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn blank_text(value: &str) -> bool {
    value.bytes().all(|byte| matches!(byte, b' ' | b'\t'))
}

fn leading_text_indent(value: &str) -> usize {
    value
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count()
}

fn common_text_prefix<'a>(left: &'a str, right: &'a str) -> &'a str {
    let length = left
        .bytes()
        .zip(right.bytes())
        .take_while(|(left, right)| left == right)
        .count();
    &left[..length]
}

fn logical_lines(islands: &[CookedIsland]) -> Vec<Line> {
    let mut lines = vec![Line::default()];
    for (island, projected) in islands.iter().enumerate() {
        let mut start = 0;
        for (newline, _) in projected.text.match_indices('\n') {
            lines
                .last_mut()
                .expect("line exists")
                .parts
                .push(Part::Literal {
                    island,
                    range: start..newline,
                });
            lines.last_mut().expect("line exists").newline = Some((island, newline..newline + 1));
            lines.push(Line::default());
            start = newline + 1;
        }
        lines
            .last_mut()
            .expect("line exists")
            .parts
            .push(Part::Literal {
                island,
                range: start..projected.text.len(),
            });
        if island + 1 < islands.len() {
            lines
                .last_mut()
                .expect("line exists")
                .parts
                .push(Part::Barrier);
        }
    }
    lines
}

fn authored_blank(line: &Line, islands: &[CookedIsland]) -> bool {
    line.parts.iter().all(|part| match part {
        Part::Literal { island, range } => islands[*island].text[range.clone()]
            .bytes()
            .all(|byte| matches!(byte, b' ' | b'\t')),
        Part::Barrier => false,
    })
}

fn common_indent(lines: &[Line], islands: &[CookedIsland]) -> String {
    let mut candidates = lines
        .iter()
        .filter(|line| !authored_blank(line, islands))
        .map(|line| leading_indent(line, islands));
    let Some(mut prefix) = candidates.next() else {
        return String::new();
    };
    for candidate in candidates {
        let length = prefix
            .bytes()
            .zip(candidate.bytes())
            .take_while(|(left, right)| left == right)
            .count();
        prefix.truncate(length);
    }
    prefix
}

fn leading_indent(line: &Line, islands: &[CookedIsland]) -> String {
    let mut indent = String::new();
    for part in &line.parts {
        match part {
            Part::Barrier => return indent,
            Part::Literal { island, range } => {
                let text = &islands[*island].text[range.clone()];
                let length = text
                    .bytes()
                    .take_while(|byte| matches!(byte, b' ' | b'\t'))
                    .count();
                indent.push_str(&text[..length]);
                if length != text.len() {
                    return indent;
                }
            }
        }
    }
    indent
}

fn rebuild(island: CookedIsland, ranges: &[Range<usize>]) -> Option<ProjectedTextIsland> {
    let mut text = String::new();
    let mut mappings = Vec::new();
    for retained in ranges {
        let output_start = text.len();
        text.push_str(&island.text[retained.clone()]);
        for mapping in &island.mappings {
            let start = mapping.projection.start.max(retained.start);
            let end = mapping.projection.end.min(retained.end);
            if start >= end {
                continue;
            }
            if !mapping.linear
                && (start != mapping.projection.start || end != mapping.projection.end)
            {
                return None;
            }
            let source = if mapping.linear {
                mapping.source.start + start - mapping.projection.start
                    ..mapping.source.start + end - mapping.projection.start
            } else {
                mapping.source.clone()
            };
            mappings.push(ByteMapping {
                projection: output_start + start - retained.start
                    ..output_start + end - retained.start,
                source,
                linear: mapping.linear,
            });
        }
    }
    coalesce_linear(&mut mappings);
    Some(ProjectedTextIsland {
        index: island.index,
        text,
        source_range: island.source_range,
        mappings,
    })
}

fn coalesce_linear(mappings: &mut Vec<ByteMapping>) {
    let mut coalesced = Vec::<ByteMapping>::new();
    for mapping in mappings.drain(..) {
        if let Some(previous) = coalesced.last_mut()
            && previous.linear
            && mapping.linear
            && previous.projection.end == mapping.projection.start
            && previous.source.end == mapping.source.start
        {
            previous.projection.end = mapping.projection.end;
            previous.source.end = mapping.source.end;
            continue;
        }
        coalesced.push(mapping);
    }
    *mappings = coalesced;
}
