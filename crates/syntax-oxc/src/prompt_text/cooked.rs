use std::ops::Range;

use oxc_ast::ast::TemplateElement;
use oxc_span::GetSpan;

use super::mapping::ByteMapping;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CookedIsland {
    pub(crate) index: u32,
    pub(crate) source_range: Range<usize>,
    pub(crate) text: String,
    pub(crate) mappings: Vec<ByteMapping>,
}

/// Projects one Oxc-cooked quasi while retaining exact authored provenance.
///
/// Oxc remains the sole JavaScript escape interpreter. This scanner only
/// partitions authored source into plain, line-ending, and escape spans, then
/// assigns the already-cooked output to those spans.
pub(crate) fn island(
    source: &str,
    index: u32,
    quasi: &TemplateElement<'_>,
) -> Option<CookedIsland> {
    let cooked = quasi.value.cooked.as_ref()?.as_str();
    let span = quasi.span();
    let source_range = span.start as usize..span.end as usize;
    let authored = &source[source_range.clone()];
    let mut cursor = CookedCursor::new(cooked, quasi.lone_surrogates);
    let mut text = String::new();
    let mut mappings = Vec::new();
    let mut authored_offset = 0;

    while authored_offset < authored.len() {
        match authored.as_bytes()[authored_offset] {
            b'\\' => {
                let mut end = escape_end(authored, authored_offset)?;
                if is_line_continuation(&authored[authored_offset..end]) {
                    authored_offset = end;
                    continue;
                }
                let scalar = cursor.next()?;
                if scalar.paired_surrogates {
                    loop {
                        let next_end = escape_end(authored, end)?;
                        if is_line_continuation(&authored[end..next_end]) {
                            end = next_end;
                            continue;
                        }
                        end = next_end;
                        break;
                    }
                } else if scalar.character.len_utf16() == 2
                    && fixed_unicode_escape(&authored[authored_offset..end])
                    && authored
                        .get(end..)
                        .is_some_and(|tail| fixed_unicode_escape_prefix(tail))
                {
                    end = escape_end(authored, end)?;
                }
                let projection_start = text.len();
                text.push(scalar.character);
                mappings.push(ByteMapping {
                    projection: projection_start..text.len(),
                    source: source_range.start + authored_offset..source_range.start + end,
                    linear: false,
                });
                authored_offset = end;
            }
            b'\r' => {
                let end = authored_offset
                    + if authored.as_bytes().get(authored_offset + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                let scalar = cursor.next()?;
                if scalar.character != '\n' || scalar.paired_surrogates {
                    return None;
                }
                let projection_start = text.len();
                text.push('\n');
                mappings.push(ByteMapping {
                    projection: projection_start..text.len(),
                    source: source_range.start + authored_offset..source_range.start + end,
                    linear: false,
                });
                authored_offset = end;
            }
            _ => {
                let character = authored[authored_offset..].chars().next()?;
                let scalar = cursor.next()?;
                if scalar.character != character || scalar.paired_surrogates {
                    return None;
                }
                let source_end = authored_offset + character.len_utf8();
                let projection_start = text.len();
                text.push(character);
                mappings.push(ByteMapping {
                    projection: projection_start..text.len(),
                    source: source_range.start + authored_offset..source_range.start + source_end,
                    linear: true,
                });
                authored_offset = source_end;
            }
        }
    }
    if !cursor.finished() {
        return None;
    }
    coalesce_plain(&mut mappings);

    Some(CookedIsland {
        index,
        source_range,
        text,
        mappings,
    })
}

#[derive(Debug, Clone, Copy)]
struct CookedScalar {
    character: char,
    paired_surrogates: bool,
}

struct CookedCursor<'a> {
    text: &'a str,
    offset: usize,
    marked_surrogates: bool,
}

impl<'a> CookedCursor<'a> {
    fn new(text: &'a str, marked_surrogates: bool) -> Self {
        Self {
            text,
            offset: 0,
            marked_surrogates,
        }
    }

    fn next(&mut self) -> Option<CookedScalar> {
        if !self.marked_surrogates || !self.text[self.offset..].starts_with('\u{fffd}') {
            let character = self.text[self.offset..].chars().next()?;
            self.offset += character.len_utf8();
            return Some(CookedScalar {
                character,
                paired_surrogates: false,
            });
        }

        let (first, first_end) = marked_code_unit(self.text, self.offset)?;
        if (0xd800..=0xdbff).contains(&first)
            && let Some((second, second_end)) = marked_code_unit(self.text, first_end)
            && (0xdc00..=0xdfff).contains(&second)
        {
            let code_point =
                0x1_0000 + ((u32::from(first) - 0xd800) << 10) + (u32::from(second) - 0xdc00);
            self.offset = second_end;
            return Some(CookedScalar {
                character: char::from_u32(code_point)?,
                paired_surrogates: true,
            });
        }

        self.offset = first_end;
        if (0xd800..=0xdfff).contains(&first) {
            return None;
        }
        Some(CookedScalar {
            character: char::from_u32(u32::from(first))?,
            paired_surrogates: false,
        })
    }

    fn finished(&self) -> bool {
        self.offset == self.text.len()
    }
}

fn marked_code_unit(text: &str, start: usize) -> Option<(u16, usize)> {
    let marker_end = start + '\u{fffd}'.len_utf8();
    let hex_end = marker_end + 4;
    let hex = text.get(marker_end..hex_end)?;
    hex.bytes()
        .all(|byte| byte.is_ascii_hexdigit())
        .then(|| {
            u16::from_str_radix(hex, 16)
                .ok()
                .map(|value| (value, hex_end))
        })
        .flatten()
}

fn coalesce_plain(mappings: &mut Vec<ByteMapping>) {
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
        } else {
            coalesced.push(mapping);
        }
    }
    *mappings = coalesced;
}

fn is_line_continuation(escape: &str) -> bool {
    matches!(
        escape,
        "\\\n" | "\\\r" | "\\\r\n" | "\\\u{2028}" | "\\\u{2029}"
    )
}

fn fixed_unicode_escape(escape: &str) -> bool {
    escape.len() == 6
        && escape.starts_with("\\u")
        && escape[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn fixed_unicode_escape_prefix(source: &str) -> bool {
    source.get(..6).is_some_and(fixed_unicode_escape)
}

fn escape_end(source: &str, start: usize) -> Option<usize> {
    let after_slash = start.checked_add(1)?;
    let next = *source.as_bytes().get(after_slash)?;
    match next {
        b'\r' => Some(
            after_slash
                + if source.as_bytes().get(after_slash + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                },
        ),
        b'\n' => Some(after_slash + 1),
        b'x' => source
            .get(after_slash + 1..after_slash + 3)
            .filter(|digits| digits.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .map(|_| after_slash + 3),
        b'u' if source.as_bytes().get(after_slash + 1) == Some(&b'{') => {
            let tail = source.get(after_slash + 2..)?;
            let close = tail.find('}')?;
            let digits = &tail[..close];
            (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_hexdigit()))
                .then_some(after_slash + 2 + close + 1)
        }
        b'u' => source
            .get(after_slash + 1..after_slash + 5)
            .filter(|digits| digits.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .map(|_| after_slash + 5),
        _ => source[after_slash..]
            .chars()
            .next()
            .map(|character| after_slash + character.len_utf8()),
    }
}
