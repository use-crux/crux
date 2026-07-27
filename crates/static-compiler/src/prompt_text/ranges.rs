use std::ops::Range;

use pulldown_cmark::Event;

/// Returns the byte extent of parser events nested directly or transitively
/// inside the `Start` event at `start`.
pub(crate) fn content(events: &[(Event<'_>, Range<usize>)], start: usize) -> Option<Range<usize>> {
    let end = matching_end(events, start)?;
    let mut range = None::<Range<usize>>;
    for (event, current) in &events[start + 1..end] {
        if !matches!(event, Event::Start(_) | Event::End(_)) {
            range = Some(match range {
                Some(found) => found.start.min(current.start)..found.end.max(current.end),
                None => current.clone(),
            });
        }
    }
    range
}

pub(crate) fn heading(
    text: &str,
    range: Range<usize>,
    content: Option<Range<usize>>,
) -> Option<Range<usize>> {
    if content.is_some() {
        return content;
    }
    let raw = text.get(range.clone())?;
    let indent = raw.bytes().take(3).take_while(is_space_or_tab).count();
    let markers = raw[indent..]
        .bytes()
        .take(6)
        .take_while(|byte| *byte == b'#')
        .count();
    (markers > 0).then_some(())?;
    let mut start = indent + markers;
    start += raw[start..].bytes().take_while(is_space_or_tab).count();
    let line_end = raw.find('\n').unwrap_or(raw.len());
    Some(range.start + start.min(line_end)..range.start + start.min(line_end))
}

pub(crate) fn code_block(
    text: &str,
    range: Range<usize>,
    content: Option<Range<usize>>,
    fenced: bool,
) -> Option<Range<usize>> {
    if content.is_some() || !fenced {
        return content;
    }
    let raw = text.get(range.clone())?;
    let opening_end = raw.find('\n').map_or(raw.len(), |offset| offset + 1);
    let fence = raw.bytes().find(|byte| matches!(byte, b'`' | b'~'))?;
    let closing_start = raw[opening_end..]
        .match_indices('\n')
        .map(|(offset, _)| opening_end + offset + 1)
        .chain(std::iter::once(opening_end))
        .filter(|start| closing_fence(&raw[*start..], fence))
        .max()
        .unwrap_or(raw.len());
    Some(range.start + opening_end..range.start + closing_start)
}

pub(crate) fn inline_code(text: &str, range: Range<usize>) -> Option<Range<usize>> {
    let raw = text.get(range.clone())?;
    let opening = raw.bytes().take_while(|byte| *byte == b'`').count();
    let closing = raw.bytes().rev().take_while(|byte| *byte == b'`').count();
    (opening > 0 && opening == closing && opening * 2 <= raw.len())
        .then_some(range.start + opening..range.end - closing)
}

pub(crate) fn autolink(range: Range<usize>) -> Option<Range<usize>> {
    (range.end >= range.start + 2).then_some(range.start + 1..range.end - 1)
}

pub(crate) fn inline_link(
    text: &str,
    range: Range<usize>,
    code_spans: &[Range<usize>],
) -> Option<(Range<usize>, Range<usize>)> {
    let raw = text.get(range.clone())?;
    let label_end = closing_label(raw, range.start, code_spans)?;
    let mut cursor = label_end + 1;
    cursor += raw.get(cursor..)?.bytes().take_while(is_space).count();
    if raw.as_bytes().get(cursor) != Some(&b'(') {
        return None;
    }
    cursor += 1;
    cursor += raw.get(cursor..)?.bytes().take_while(is_space).count();
    let destination = destination(raw, cursor)?;
    Some((
        range.start + 1..range.start + label_end,
        range.start + destination.start..range.start + destination.end,
    ))
}

pub(crate) fn blockquote_markers(
    text: &str,
    range: Range<usize>,
    depth: usize,
) -> Vec<Range<usize>> {
    line_ranges(text, range)
        .filter_map(|line| {
            let raw = text.get(line.clone())?;
            let mut cursor = raw
                .bytes()
                .take(4)
                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                .count();
            for level in 0..=depth {
                if raw.as_bytes().get(cursor) != Some(&b'>') {
                    return None;
                }
                if level == depth {
                    return Some(line.start + cursor..line.start + cursor + 1);
                }
                cursor += 1;
                cursor += raw
                    .get(cursor..)?
                    .bytes()
                    .take_while(|byte| matches!(byte, b' ' | b'\t'))
                    .count();
            }
            None
        })
        .collect()
}

pub(crate) fn list_marker(text: &str, range: Range<usize>) -> Option<Range<usize>> {
    let raw = text.get(range.clone())?;
    let indent = raw
        .bytes()
        .take(4)
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    let tail = raw.get(indent..)?;
    if matches!(tail.as_bytes().first(), Some(b'-' | b'+' | b'*')) {
        return Some(range.start + indent..range.start + indent + 1);
    }
    let digits = tail
        .bytes()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    (digits > 0 && matches!(tail.as_bytes().get(digits), Some(b'.' | b')')))
        .then_some(range.start + indent..range.start + indent + digits + 1)
}

pub(crate) fn matching_end(events: &[(Event<'_>, Range<usize>)], start: usize) -> Option<usize> {
    let mut depth = 0;
    for (index, (event, _)) in events.iter().enumerate().skip(start + 1) {
        match event {
            Event::Start(_) => depth += 1,
            Event::End(_) if depth == 0 => return Some(index),
            Event::End(_) => depth -= 1,
            _ => {}
        }
    }
    None
}

fn closing_label(raw: &str, start: usize, code_spans: &[Range<usize>]) -> Option<usize> {
    (raw.as_bytes().first() == Some(&b'[')).then_some(())?;
    let mut depth = 1;
    let mut escaped = false;
    for (offset, byte) in raw.bytes().enumerate().skip(1) {
        if code_spans
            .iter()
            .any(|span| span.contains(&(start + offset)))
        {
            escaped = false;
            continue;
        }
        if escaped {
            escaped = false;
            continue;
        }
        match byte {
            b'\\' => escaped = true,
            b'[' => depth += 1,
            b']' if depth == 1 => return Some(offset),
            b']' => depth -= 1,
            _ => {}
        }
    }
    None
}

fn destination(raw: &str, start: usize) -> Option<Range<usize>> {
    if raw.as_bytes().get(start) == Some(&b'<') {
        let end = raw.get(start + 1..)?.find('>')? + start + 1;
        return Some(start + 1..end);
    }
    let mut depth = 0;
    let mut escaped = false;
    for (offset, byte) in raw.bytes().enumerate().skip(start) {
        if escaped {
            escaped = false;
            continue;
        }
        match byte {
            b'\\' => escaped = true,
            b'(' => depth += 1,
            b')' if depth == 0 => return Some(start..offset),
            b')' => depth -= 1,
            byte if is_space(&byte) && depth == 0 => return Some(start..offset),
            _ => {}
        }
    }
    None
}

fn line_ranges(text: &str, range: Range<usize>) -> impl Iterator<Item = Range<usize>> + '_ {
    let mut cursor = range.start;
    std::iter::from_fn(move || {
        if cursor >= range.end {
            return None;
        }
        let end = text[cursor..range.end]
            .find('\n')
            .map_or(range.end, |offset| cursor + offset);
        let line = cursor..end;
        cursor = (end + 1).min(range.end);
        Some(line)
    })
}

fn closing_fence(line: &str, fence: u8) -> bool {
    let line = line.strip_suffix('\n').unwrap_or(line);
    let indent = line.bytes().take(3).take_while(is_space_or_tab).count();
    let markers = line[indent..]
        .bytes()
        .take_while(|byte| *byte == fence)
        .count();
    markers >= 3
        && line[indent + markers..]
            .bytes()
            .all(|byte| matches!(byte, b' ' | b'\t' | b'\r'))
}

fn is_space_or_tab(byte: &u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

fn is_space(byte: &u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}
