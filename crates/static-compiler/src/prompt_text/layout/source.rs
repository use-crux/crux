use std::ops::Range;

use crux_indexer_protocol::prompt_text::{PromptTextPosition, PromptTextRange};

pub(super) fn byte_range(source: &str, range: PromptTextRange) -> Option<Range<usize>> {
    let start = byte_offset(source, range.start)?;
    let end = byte_offset(source, range.end)?;
    (start <= end).then_some(start..end)
}

pub(super) fn text<'a>(source: &'a str, range: PromptTextRange) -> Option<&'a str> {
    source.get(byte_range(source, range)?)
}

pub(super) fn byte_offset(source: &str, position: PromptTextPosition) -> Option<usize> {
    let mut line = 0u32;
    let mut line_start = 0usize;
    for (index, byte) in source.bytes().enumerate() {
        if line == position.line {
            break;
        }
        if byte == b'\n' {
            line += 1;
            line_start = index + 1;
        }
    }
    if line != position.line {
        return None;
    }
    let line_end = source[line_start..]
        .find('\n')
        .map_or(source.len(), |offset| line_start + offset);
    let line_text = source.get(line_start..line_end)?;
    let mut utf16 = 0u32;
    for (offset, character) in line_text.char_indices() {
        if utf16 == position.character {
            return Some(line_start + offset);
        }
        utf16 = utf16.checked_add(character.len_utf16() as u32)?;
        if utf16 > position.character {
            return None;
        }
    }
    (utf16 == position.character).then_some(line_end)
}

pub(super) fn local_eols(source: &str, range: &Range<usize>) -> (&'static str, &'static str) {
    let tokens = eol_tokens(source);
    let before = tokens
        .iter()
        .rev()
        .find(|token| token.range.end <= range.start);
    let after = tokens.iter().find(|token| token.range.start >= range.end);
    let left = before.or(after).map_or("\n", |token| token.text);
    let right = after.or(before).map_or("\n", |token| token.text);
    (left, right)
}

struct EolToken {
    range: Range<usize>,
    text: &'static str,
}

fn eol_tokens(source: &str) -> Vec<EolToken> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    for index in 0..bytes.len() {
        if bytes[index] != b'\n' {
            continue;
        }
        if index > 0 && bytes[index - 1] == b'\r' {
            tokens.push(EolToken {
                range: index - 1..index + 1,
                text: "\r\n",
            });
        } else {
            tokens.push(EolToken {
                range: index..index + 1,
                text: "\n",
            });
        }
    }
    tokens
}

pub(super) fn carrier_indent(
    source: &str,
    template: PromptTextRange,
    barrier_start: usize,
) -> Option<&str> {
    let template_start = byte_offset(source, template.start)?;
    (source.as_bytes().get(template_start) == Some(&b'`')).then_some(())?;
    let physical_start = source[..barrier_start]
        .rfind('\n')
        .map_or(0, |newline| newline + 1);
    let content_start = physical_start.max(template_start + 1);
    let line = source.get(content_start..barrier_start)?;
    let length = line
        .bytes()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    line.get(..length)
}
