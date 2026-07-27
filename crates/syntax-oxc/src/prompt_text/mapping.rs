use std::ops::Range;

use crux_indexer_protocol::prompt_text::{
    PromptTextOffsetRange, PromptTextPosition, PromptTextRange, PromptTextSourceMapping,
};
use oxc_span::Span;

use super::ProjectedTextIsland;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ByteMapping {
    pub(crate) projection: Range<usize>,
    pub(crate) source: Range<usize>,
    pub(crate) linear: bool,
}

pub(crate) struct SourceMap<'source> {
    source: &'source str,
    line_starts: Vec<usize>,
}

impl<'source> SourceMap<'source> {
    pub(crate) fn new(source: &'source str) -> Self {
        let mut line_starts = vec![0];
        line_starts.extend(
            source
                .bytes()
                .enumerate()
                .filter_map(|(index, byte)| (byte == b'\n').then_some(index + 1)),
        );
        Self {
            source,
            line_starts,
        }
    }

    pub(crate) fn span(&self, span: Span) -> PromptTextRange {
        self.bytes(span.start as usize..span.end as usize)
    }

    pub(crate) fn bytes(&self, range: Range<usize>) -> PromptTextRange {
        PromptTextRange {
            start: self.position(range.start),
            end: self.position(range.end),
        }
    }

    fn position(&self, offset: usize) -> PromptTextPosition {
        let offset = offset.min(self.source.len());
        let line = match self.line_starts.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        };
        let line_start = self.line_starts[line];
        PromptTextPosition {
            line: line as u32,
            character: self.source[line_start..offset].encode_utf16().count() as u32,
        }
    }
}

pub(crate) fn protocol_mappings(
    source: &str,
    island: &ProjectedTextIsland,
) -> Vec<PromptTextSourceMapping> {
    let map = SourceMap::new(source);
    island
        .mappings
        .iter()
        .map(|mapping| PromptTextSourceMapping {
            island: island.index,
            projection_range: PromptTextOffsetRange {
                start: utf16_offset(&island.text, mapping.projection.start),
                end: utf16_offset(&island.text, mapping.projection.end),
            },
            source_range: map.bytes(mapping.source.clone()),
        })
        .collect()
}

/// Maps a parser byte range within one projected island back to UTF-16 source.
///
/// Linear mappings permit endpoints inside retained authored text. Nonlinear
/// mappings, such as escapes and CRLF, map only at complete segment
/// boundaries. Start and end endpoints deliberately use opposite bias so
/// removed indentation between adjacent segments is never reintroduced.
pub fn map_projected_range(
    source: &str,
    island: &ProjectedTextIsland,
    range: Range<usize>,
) -> Option<PromptTextRange> {
    if range.end > island.text.len()
        || !island.text.is_char_boundary(range.start)
        || !island.text.is_char_boundary(range.end)
    {
        return None;
    }
    let start = map_start(island, range.start)?;
    let end = map_end(island, range.end)?;
    (start <= end).then(|| SourceMap::new(source).bytes(start..end))
}

fn map_start(island: &ProjectedTextIsland, offset: usize) -> Option<usize> {
    if offset == island.text.len() {
        return island.mappings.last().map(|mapping| mapping.source.end);
    }
    let mapping = island
        .mappings
        .iter()
        .find(|mapping| mapping.projection.start <= offset && offset < mapping.projection.end)?;
    map_offset(mapping, offset)
}

fn map_end(island: &ProjectedTextIsland, offset: usize) -> Option<usize> {
    if offset == 0 {
        return island.mappings.first().map(|mapping| mapping.source.start);
    }
    let mapping =
        island.mappings.iter().rev().find(|mapping| {
            mapping.projection.start < offset && offset <= mapping.projection.end
        })?;
    map_offset(mapping, offset)
}

fn map_offset(mapping: &ByteMapping, offset: usize) -> Option<usize> {
    if offset == mapping.projection.start {
        return Some(mapping.source.start);
    }
    if offset == mapping.projection.end {
        return Some(mapping.source.end);
    }
    mapping
        .linear
        .then(|| mapping.source.start + offset - mapping.projection.start)
}

fn utf16_offset(text: &str, byte: usize) -> u32 {
    text[..byte].encode_utf16().count() as u32
}
