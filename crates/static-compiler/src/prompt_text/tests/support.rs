use crux_indexer_protocol::prompt_text::PromptTextRange;

pub(super) fn text_at(source: &str, range: &PromptTextRange) -> String {
    let lines = source.split('\n').collect::<Vec<_>>();
    if range.start.line == range.end.line {
        return utf16_slice(
            lines[range.start.line as usize],
            range.start.character,
            range.end.character,
        );
    }
    let mut text = utf16_slice(
        lines[range.start.line as usize],
        range.start.character,
        lines[range.start.line as usize].encode_utf16().count() as u32,
    );
    text.push('\n');
    for line in range.start.line + 1..range.end.line {
        text.push_str(lines[line as usize]);
        text.push('\n');
    }
    text.push_str(&utf16_slice(
        lines[range.end.line as usize],
        0,
        range.end.character,
    ));
    text
}

fn utf16_slice(text: &str, start: u32, end: u32) -> String {
    String::from_utf16(&text.encode_utf16().collect::<Vec<_>>()[start as usize..end as usize])
        .expect("fixture ranges must end on scalar boundaries")
}
