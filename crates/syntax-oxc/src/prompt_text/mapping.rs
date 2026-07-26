use std::ops::Range;

use crux_indexer_protocol::prompt_text::{PromptTextPosition, PromptTextRange};
use oxc_span::Span;

use super::ProjectedTextIsland;

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

/// Maps a parser byte range within one projected island back to UTF-16 source.
///
/// Phase 3 islands are exact authored slices. Phase 4 extends this function
/// with segmented escape mappings without changing classifier ownership.
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
    Some(
        SourceMap::new(source)
            .bytes(island.source_start + range.start..island.source_start + range.end),
    )
}
