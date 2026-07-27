use crux_indexer_protocol::prompt_text::{PromptTextPreviewSegment, PromptTextRange};
use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

use super::{
    FragmentOutcome, FragmentReference, Placement, RenderFlags,
    segments::{FragmentProvenance, PreviewSegments},
    value,
    weave::{Line, Part},
};

struct RenderedLine {
    segments: PreviewSegments,
    newline: Option<PromptTextPreviewSegment>,
    authored_blank: bool,
    removed: bool,
}

pub(super) fn render(
    source: &str,
    projected: &ProjectedPromptTextTemplate,
    max_preview_bytes: u32,
    provenance: Option<FragmentProvenance>,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> (PreviewSegments, RenderFlags) {
    let lines = super::weave::lines(source, projected);
    let mut rendered = Vec::with_capacity(lines.len());
    let mut flags = RenderFlags::default();
    let materialization_limit = u64::from(max_preview_bytes).saturating_add(source.len() as u64);
    let mut materialized_bytes = 0_u64;
    for line in lines {
        let remaining = materialization_limit.saturating_sub(materialized_bytes);
        let (rendered_line, mut line_flags) =
            render_line(line, projected, remaining, provenance.clone(), fragment);
        materialized_bytes = materialized_bytes
            .saturating_add(rendered_line.segments.bytes())
            .saturating_add(
                rendered_line
                    .newline
                    .as_ref()
                    .map_or(0, |segment| segment_text(segment).len() as u64),
            );
        if rendered_line.segments.overflowed() {
            line_flags.mark_byte_truncated();
        }
        rendered.push(rendered_line);
        flags.merge(line_flags);
        if flags.is_truncated() {
            break;
        }
    }
    remove_empty_block_seams(&mut rendered);

    let mut output = PreviewSegments::scoped(u64::from(max_preview_bytes), provenance);
    let mut newline = None;
    for (index, line) in rendered.into_iter().enumerate() {
        if index > 0
            && let Some(separator) = newline.take()
        {
            output.push(separator);
            if output.overflowed() {
                break;
            }
        }
        output.extend(line.segments);
        if output.overflowed() {
            break;
        }
        newline = line.newline;
    }
    if output.overflowed() {
        flags.mark_byte_truncated();
    }
    (output, flags)
}

fn render_line(
    line: Line,
    projected: &ProjectedPromptTextTemplate,
    limit: u64,
    provenance: Option<FragmentProvenance>,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> (RenderedLine, RenderFlags) {
    let interpolation = line
        .parts
        .iter()
        .enumerate()
        .filter_map(|(index, part)| matches!(part, Part::Interpolation(_)).then_some(index))
        .collect::<Vec<_>>();
    let block = interpolation.len() == 1
        && line.parts.iter().all(|part| match part {
            Part::Literal(segment) => segment_text(segment)
                .bytes()
                .all(|byte| matches!(byte, b' ' | b'\t')),
            Part::Interpolation(_) => true,
        });
    let authored_blank = interpolation.is_empty()
        && line.parts.iter().all(|part| match part {
            Part::Literal(segment) => segment_text(segment)
                .bytes()
                .all(|byte| matches!(byte, b' ' | b'\t')),
            Part::Interpolation(_) => false,
        });

    if !block {
        let mut segments = PreviewSegments::scoped(limit, provenance);
        let mut flags = RenderFlags::default();
        for part in line.parts {
            flags.merge(render_part(
                &mut segments,
                part,
                projected,
                Placement::Inline,
                fragment,
            ));
            if segments.overflowed() {
                flags.mark_byte_truncated();
            }
            if flags.is_truncated() {
                return (
                    RenderedLine {
                        segments,
                        newline: line.newline,
                        authored_blank,
                        removed: false,
                    },
                    flags,
                );
            }
        }
        return (
            RenderedLine {
                segments,
                newline: line.newline,
                authored_blank,
                removed: false,
            },
            flags,
        );
    }

    let interpolation_part = interpolation[0];
    let indent = literal_parts(&line.parts[..interpolation_part]);
    let indent_range = literal_range(&line.parts[..interpolation_part]);
    let mut value_segments = PreviewSegments::scoped(limit, provenance.clone());
    let Part::Interpolation(value_index) = line.parts[interpolation_part] else {
        unreachable!("block line has exactly one interpolation");
    };
    let mut flags = projected.interpolations.get(value_index).map_or_else(
        RenderFlags::default,
        |interpolation| {
            value::render(
                &mut value_segments,
                interpolation,
                Placement::Block {
                    indent,
                    indent_range,
                },
                fragment,
            )
        },
    );
    if value_segments.overflowed() {
        flags.mark_byte_truncated();
    }
    if value_segments.is_empty() && !flags.is_truncated() {
        return (
            RenderedLine {
                segments: PreviewSegments::default(),
                newline: line.newline,
                authored_blank: false,
                removed: true,
            },
            flags,
        );
    }
    let mut segments = PreviewSegments::scoped(limit, provenance);
    for (index, part) in line.parts.into_iter().enumerate() {
        if index == interpolation_part {
            segments.extend(std::mem::take(&mut value_segments));
            if segments.overflowed() {
                flags.mark_byte_truncated();
            }
            if flags.is_truncated() {
                break;
            }
        } else if let Part::Literal(segment) = part {
            segments.push(segment);
        }
    }
    if segments.overflowed() {
        flags.mark_byte_truncated();
    }
    (
        RenderedLine {
            segments,
            newline: line.newline,
            authored_blank: false,
            removed: false,
        },
        flags,
    )
}

fn render_part(
    segments: &mut PreviewSegments,
    part: Part,
    projected: &ProjectedPromptTextTemplate,
    placement: Placement,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    match part {
        Part::Literal(segment) => {
            segments.push(segment);
            RenderFlags::default()
        }
        Part::Interpolation(index) => {
            if let Some(interpolation) = projected.interpolations.get(index) {
                value::render(segments, interpolation, placement, fragment)
            } else {
                RenderFlags::default()
            }
        }
    }
}

fn literal_parts(parts: &[Part]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            Part::Literal(segment) => Some(segment_text(segment)),
            Part::Interpolation(_) => None,
        })
        .collect()
}

fn literal_range(parts: &[Part]) -> Option<PromptTextRange> {
    let mut ranges = parts.iter().filter_map(|part| match part {
        Part::Literal(PromptTextPreviewSegment::AuthoredLiteral { range, .. }) => Some(*range),
        _ => None,
    });
    let first = ranges.next()?;
    let last = ranges.last().unwrap_or(first);
    Some(PromptTextRange {
        start: first.start,
        end: last.end,
    })
}

fn remove_empty_block_seams(lines: &mut Vec<RenderedLine>) {
    let mut index = 0;
    while index < lines.len() {
        if !lines[index].removed {
            index += 1;
            continue;
        }
        let mut before = 0;
        while index > before && lines[index - before - 1].authored_blank {
            before += 1;
        }
        let mut after = 0;
        while lines
            .get(index + after + 1)
            .is_some_and(|line| line.authored_blank)
        {
            after += 1;
        }
        if before >= after {
            lines.drain(index + 1..index + 1 + after);
        } else {
            lines.drain(index - before..index);
            index -= before;
        }
        lines.remove(index);
    }
}

fn segment_text(segment: &PromptTextPreviewSegment) -> &str {
    match segment {
        PromptTextPreviewSegment::AuthoredLiteral { text, .. }
        | PromptTextPreviewSegment::KnownValue { text, .. }
        | PromptTextPreviewSegment::Fragment { text, .. }
        | PromptTextPreviewSegment::Placeholder { text, .. } => text,
    }
}
