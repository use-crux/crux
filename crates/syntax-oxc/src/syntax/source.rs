use oxc_span::{GetSpan, Span};
use sha2::{Digest, Sha256};

use crate::protocol::{SourceLocation, SourceRange, SourceSnippet};

pub struct SourceView<'a> {
    file: &'a str,
    source: &'a str,
    line_starts: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct SourceNeedleIndex {
    positions: Vec<usize>,
}

impl<'a> SourceView<'a> {
    pub fn new(file: &'a str, source: &'a str) -> Self {
        let mut line_starts = vec![0];
        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                line_starts.push(index + 1);
            }
        }
        Self {
            file,
            source,
            line_starts,
        }
    }

    pub fn location_for_span<T: GetSpan>(&self, node: &T) -> SourceLocation {
        self.location_for_offset(node.span().start as usize)
    }

    pub fn location_for_offset(&self, offset: usize) -> SourceLocation {
        let line_index = self.line_index_for_offset(offset);
        let line_start = self.line_starts.get(line_index).copied().unwrap_or(0);
        let column = self
            .source
            .get(line_start..offset)
            .map(|text| text.encode_utf16().count() + 1)
            .unwrap_or_else(|| offset.saturating_sub(line_start) + 1);
        SourceLocation {
            file: self.file.to_string(),
            line: line_index + 1,
            column,
        }
    }

    pub fn snippet_for_span<T: GetSpan>(&self, node: &T) -> SourceSnippet {
        self.snippet_for_raw_span(node.span())
    }

    pub fn text_for_span<T: GetSpan>(&self, node: &T) -> String {
        self.text_for_raw_span(node.span())
    }

    pub fn text_for_raw_span(&self, span: Span) -> String {
        self.source
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
            .to_string()
    }

    pub fn needle_index(&self, needles: &[String]) -> SourceNeedleIndex {
        let mut positions = Vec::new();
        for needle in needles {
            if needle.is_empty() {
                continue;
            }
            positions.extend(self.source.match_indices(needle).map(|(index, _)| index));
        }
        positions.sort_unstable();
        positions.dedup();
        SourceNeedleIndex { positions }
    }

    pub fn snippet_for_raw_span(&self, span: Span) -> SourceSnippet {
        let start = self.location_for_offset(span.start as usize);
        let end = self.location_for_offset(span.end as usize);
        SourceSnippet {
            source: self.text_for_raw_span(span),
            language: language_for_file(self.file).to_string(),
            range: SourceRange {
                file: self.file.to_string(),
                start_line: start.line,
                start_column: start.column,
                end_line: end.line,
                end_column: end.column,
            },
            truncated: false,
        }
    }

    fn line_index_for_offset(&self, offset: usize) -> usize {
        match self.line_starts.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        }
    }
}

impl SourceNeedleIndex {
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    pub fn contains_span(&self, span: Span) -> bool {
        let start = span.start as usize;
        let end = span.end as usize;
        self.positions.binary_search(&start).map_or_else(
            |index| {
                self.positions
                    .get(index)
                    .is_some_and(|position| *position < end)
            },
            |_| true,
        )
    }
}

pub fn language_for_file(file: &str) -> &'static str {
    if file.ends_with(".ts") || file.ends_with(".tsx") {
        "typescript"
    } else {
        "javascript"
    }
}

pub fn sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
