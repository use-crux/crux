use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

use super::structure::{heading, heading_level};

/// Classifies every literal island independently with default CommonMark.
pub(crate) fn classify(source: &str, projected: &mut ProjectedPromptTextTemplate) {
    let mut block_index = projected.template.blocks.len() as u32;
    for island in &projected.islands {
        let events = Parser::new_ext(&island.text, Options::empty())
            .into_offset_iter()
            .collect::<Vec<_>>();
        for (event_index, (event, range)) in events.iter().enumerate() {
            let Event::Start(Tag::Heading { level, .. }) = event else {
                continue;
            };
            let Some(text_range) = heading_text_range(&events[event_index + 1..]) else {
                continue;
            };
            if let Some(block) = heading(
                source,
                island,
                block_index,
                heading_level(*level),
                range.clone(),
                text_range,
            ) {
                projected.template.blocks.push(block);
                block_index += 1;
            }
        }
    }
}

fn heading_text_range(
    events: &[(Event<'_>, std::ops::Range<usize>)],
) -> Option<std::ops::Range<usize>> {
    let mut start = None;
    let mut end = None;
    for (event, range) in events {
        match event {
            Event::End(TagEnd::Heading(_)) => break,
            Event::Text(_) | Event::Code(_) => {
                start.get_or_insert(range.start);
                end = Some(range.end);
            }
            _ => {}
        }
    }
    Some(start?..end?)
}
