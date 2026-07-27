use pulldown_cmark::Event;

use super::ranges;

/// Produces the provider-neutral display label for one balanced heading.
pub(super) fn from_events(
    events: &[(Event<'_>, std::ops::Range<usize>)],
    start: usize,
    level: u8,
) -> Option<String> {
    let end = ranges::matching_end(events, start)?;
    let mut label = String::new();
    let mut pending_space = false;

    for (event, _) in &events[start + 1..end] {
        match event {
            Event::Text(value) | Event::Code(value) => {
                append_normalized(&mut label, &mut pending_space, value);
            }
            Event::SoftBreak | Event::HardBreak => {
                pending_space = !label.is_empty();
            }
            Event::Start(_)
            | Event::End(_)
            | Event::Html(_)
            | Event::InlineHtml(_)
            | Event::FootnoteReference(_)
            | Event::TaskListMarker(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_)
            | Event::Rule => {}
        }
    }

    if label.is_empty() {
        label = format!("Heading {level}");
    }
    Some(label)
}

fn append_normalized(label: &mut String, pending_space: &mut bool, value: &str) {
    for character in value.chars() {
        if is_unicode_white_space(character) {
            *pending_space = !label.is_empty();
            continue;
        }
        if *pending_space {
            label.push(' ');
            *pending_space = false;
        }
        label.push(character);
    }
}

fn is_unicode_white_space(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{0085}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
    )
}
