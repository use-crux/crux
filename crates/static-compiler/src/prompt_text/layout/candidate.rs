use std::ops::Range;

use crux_indexer_protocol::prompt_text::{
    PromptTextLineIsolationEdit, PromptTextPosition, PromptTextRange,
};
use crux_indexer_syntax_oxc::prompt_text::{ProjectedPromptTextTemplate, map_projected_range};

use super::source;

pub(super) struct Proposal {
    pub(super) edit: PromptTextLineIsolationEdit,
    pub(super) source_range: Range<usize>,
    pub(super) left_content: bool,
    pub(super) right_content: bool,
    pub(super) left_gap: Range<usize>,
    pub(super) right_gap: Range<usize>,
    pub(super) normalized_indent: String,
}

pub(super) fn propose(
    source_text: &str,
    projected: &ProjectedPromptTextTemplate,
    barrier_index: usize,
) -> Option<Proposal> {
    let barrier = projected
        .template
        .interpolation_barriers
        .get(barrier_index)?;
    let left_island = projected.islands.get(barrier_index)?;
    let right_island = projected.islands.get(barrier_index + 1)?;
    (barrier.index as usize == barrier_index
        && projected.islands.len() == projected.template.interpolation_barriers.len() + 1)
        .then_some(())?;

    // A neighboring barrier shares this normalized line unless the intervening
    // island contains a cooked line boundary.
    if (barrier_index > 0 && !left_island.text.contains('\n'))
        || (barrier_index + 1 < projected.template.interpolation_barriers.len()
            && !right_island.text.contains('\n'))
    {
        return None;
    }

    let left_line_start = left_island
        .text
        .rfind('\n')
        .map_or(0, |newline| newline + 1);
    let right_line_end = right_island
        .text
        .find('\n')
        .unwrap_or(right_island.text.len());
    if let Some(newline) = left_island.text.rfind('\n')
        && !exact_newline(source_text, left_island, newline)?
    {
        return None;
    }
    if let Some(newline) = right_island.text.find('\n')
        && !exact_newline(source_text, right_island, newline)?
    {
        return None;
    }
    let normalized_indent_length = left_island.text[left_line_start..]
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    let normalized_indent =
        left_island.text[left_line_start..left_line_start + normalized_indent_length].to_owned();
    let left_gap_start = left_island.text[left_line_start..]
        .trim_end_matches([' ', '\t'])
        .len()
        + left_line_start;
    let right_gap_end = right_island.text[..right_line_end]
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    let left_content = left_gap_start > left_line_start;
    let right_content = right_gap_end < right_line_end;
    (left_content || right_content).then_some(())?;

    let barrier_bytes = source::byte_range(source_text, barrier.range)?;
    let left_gap = left_gap_start..left_island.text.len();
    let right_gap = 0..right_gap_end;
    let edit_start = if left_content {
        mapped_gap(
            source_text,
            left_island,
            left_gap.clone(),
            barrier.range.start,
            true,
        )?
        .start
    } else {
        barrier_bytes.start
    };
    let edit_end = if right_content {
        mapped_gap(
            source_text,
            right_island,
            right_gap.clone(),
            barrier.range.end,
            false,
        )?
        .end
    } else {
        barrier_bytes.end
    };
    let source_range = edit_start..edit_end;
    let expected_text = source_text.get(source_range.clone())?.to_owned();
    let exact_barrier = source_text.get(barrier_bytes)?.to_owned();
    let indent = source::carrier_indent(
        source_text,
        projected.template.template_range,
        source::byte_offset(source_text, barrier.range.start)?,
    )?;
    let (left_eol, right_eol) = source::local_eols(source_text, &source_range);
    let mut new_text = String::new();
    if left_content {
        new_text.push_str(left_eol);
        new_text.push_str(indent);
    }
    new_text.push_str(&exact_barrier);
    if right_content {
        new_text.push_str(right_eol);
        new_text.push_str(indent);
    }
    (!expected_text.is_empty() && expected_text != new_text).then_some(())?;

    Some(Proposal {
        edit: PromptTextLineIsolationEdit {
            range: PromptTextRange {
                start: source_position(source_text, source_range.start)?,
                end: source_position(source_text, source_range.end)?,
            },
            expected_text,
            new_text,
        },
        source_range,
        left_content,
        right_content,
        left_gap,
        right_gap,
        normalized_indent,
    })
}

fn exact_newline(
    source_text: &str,
    island: &crux_indexer_syntax_oxc::prompt_text::ProjectedTextIsland,
    offset: usize,
) -> Option<bool> {
    let mapped = map_projected_range(source_text, island, offset..offset + 1)?;
    let authored = source::text(source_text, mapped)?;
    Some(matches!(authored, "\n" | "\r\n"))
}

fn mapped_gap(
    source_text: &str,
    island: &crux_indexer_syntax_oxc::prompt_text::ProjectedTextIsland,
    projected: Range<usize>,
    barrier_edge: PromptTextPosition,
    left: bool,
) -> Option<Range<usize>> {
    if projected.is_empty() {
        let edge = source::byte_offset(source_text, barrier_edge)?;
        return Some(edge..edge);
    }
    let mapped = map_projected_range(source_text, island, projected.clone())?;
    if left {
        (mapped.end == barrier_edge).then_some(())?;
    } else {
        (mapped.start == barrier_edge).then_some(())?;
    }
    let bytes = source::byte_range(source_text, mapped)?;
    let text = source_text.get(bytes.clone())?;
    (text.len() == projected.len() && text.bytes().all(|byte| matches!(byte, b' ' | b'\t')))
        .then_some(bytes)
}

fn source_position(source: &str, byte: usize) -> Option<PromptTextPosition> {
    source.get(..byte)?;
    let line = source[..byte].bytes().filter(|byte| *byte == b'\n').count();
    let line_start = source[..byte].rfind('\n').map_or(0, |index| index + 1);
    Some(PromptTextPosition {
        line: u32::try_from(line).ok()?,
        character: u32::try_from(source[line_start..byte].encode_utf16().count()).ok()?,
    })
}
