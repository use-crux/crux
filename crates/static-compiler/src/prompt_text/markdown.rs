use crux_indexer_protocol::prompt_text::{PromptTextBlock, PromptTextLink, PromptTextSpan};
use crux_indexer_syntax_oxc::prompt_text::{ProjectedPromptTextTemplate, ProjectedTextIsland};
use pulldown_cmark::{CodeBlockKind, Event, LinkType, Options, Parser, Tag, TagEnd};

use super::{
    ranges,
    structure::{StructureWriter, heading_level},
};

/// Classifies every literal island independently with default CommonMark.
pub(crate) fn classify(source: &str, projected: &mut ProjectedPromptTextTemplate) {
    for island in &projected.islands {
        let events = Parser::new_ext(&island.text, Options::empty())
            .into_offset_iter()
            .collect::<Vec<_>>();
        classify_island(source, island, &events, &mut projected.template);
    }
}

fn classify_island(
    source: &str,
    island: &ProjectedTextIsland,
    events: &[(Event<'_>, std::ops::Range<usize>)],
    template: &mut crux_indexer_protocol::prompt_text::PromptTextTemplate,
) {
    let mut writer = StructureWriter::new(source, island, template);
    let mut blockquote_depth = 0;

    for (event_index, (event, range)) in events.iter().enumerate() {
        match event {
            Event::Start(tag) => {
                let node = start(
                    &mut writer,
                    events,
                    event_index,
                    tag,
                    range.clone(),
                    blockquote_depth,
                );
                writer.begin(node);
                if matches!(tag, Tag::BlockQuote(_)) {
                    blockquote_depth += 1;
                }
            }
            Event::End(end) => {
                writer.end();
                if matches!(end, TagEnd::BlockQuote(_)) {
                    blockquote_depth = blockquote_depth.saturating_sub(1);
                }
            }
            Event::Code(_) => inline_code(&mut writer, range.clone()),
            Event::InlineHtml(_) => inline_html(&mut writer, range.clone()),
            Event::SoftBreak => break_span(&mut writer, range.clone(), false),
            Event::HardBreak => break_span(&mut writer, range.clone(), true),
            Event::Rule => thematic_break(&mut writer, range.clone()),
            Event::Text(_)
            | Event::Html(_)
            | Event::FootnoteReference(_)
            | Event::TaskListMarker(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_) => {}
        }
    }
}

fn start(
    writer: &mut StructureWriter<'_>,
    events: &[(Event<'_>, std::ops::Range<usize>)],
    event_index: usize,
    tag: &Tag<'_>,
    projected_range: std::ops::Range<usize>,
    blockquote_depth: usize,
) -> Option<crux_indexer_protocol::prompt_text::PromptTextNodeRef> {
    let range = writer.map(projected_range.clone())?;
    match tag {
        Tag::Paragraph => Some(writer.block(|index, island| PromptTextBlock::Paragraph {
            index,
            island,
            range,
        })),
        Tag::Heading { level, .. } => {
            let text_range = writer.map(ranges::heading(
                writer.text(),
                projected_range,
                ranges::content(events, event_index),
            )?)?;
            Some(writer.block(|index, island| PromptTextBlock::Heading {
                index,
                island,
                level: heading_level(*level),
                range,
                text_range,
            }))
        }
        Tag::BlockQuote(_) => {
            let marker_ranges =
                ranges::blockquote_markers(writer.text(), projected_range, blockquote_depth)
                    .into_iter()
                    .map(|marker| writer.map(marker))
                    .collect::<Option<Vec<_>>>()?;
            Some(writer.block(|index, island| PromptTextBlock::Blockquote {
                index,
                island,
                range,
                marker_ranges,
            }))
        }
        Tag::List(start) => Some(writer.block(|index, island| PromptTextBlock::List {
            index,
            island,
            range,
            ordered: start.is_some(),
            start: *start,
        })),
        Tag::Item => {
            let marker_range = writer.map(ranges::list_marker(writer.text(), projected_range)?)?;
            Some(writer.block(|index, island| PromptTextBlock::ListItem {
                index,
                island,
                range,
                marker_range,
            }))
        }
        Tag::CodeBlock(kind) => {
            let (fenced, info) = match kind {
                CodeBlockKind::Indented => (false, None),
                CodeBlockKind::Fenced(info) => (true, (!info.is_empty()).then(|| info.to_string())),
            };
            let content_range = writer.map(ranges::code_block(
                writer.text(),
                projected_range,
                ranges::content(events, event_index),
                fenced,
            )?)?;
            Some(writer.block(|index, island| PromptTextBlock::CodeBlock {
                index,
                island,
                range,
                content_range,
                fenced,
                info,
            }))
        }
        Tag::HtmlBlock => Some(writer.block(|index, island| PromptTextBlock::Html {
            index,
            island,
            range,
        })),
        Tag::Emphasis | Tag::Strong => {
            let text_range = writer.map(ranges::content(events, event_index)?)?;
            if matches!(tag, Tag::Emphasis) {
                Some(writer.span(|index, island| PromptTextSpan::Emphasis {
                    index,
                    island,
                    range,
                    text_range,
                }))
            } else {
                Some(writer.span(|index, island| PromptTextSpan::Strong {
                    index,
                    island,
                    range,
                    text_range,
                }))
            }
        }
        Tag::Link {
            link_type,
            dest_url,
            title,
            ..
        } => link(
            writer,
            events,
            event_index,
            *link_type,
            dest_url.as_ref(),
            title.as_ref(),
            projected_range,
            range,
        ),
        _ => None,
    }
}

fn link(
    writer: &mut StructureWriter<'_>,
    events: &[(Event<'_>, std::ops::Range<usize>)],
    event_index: usize,
    link_type: LinkType,
    destination: &str,
    title: &str,
    projected_range: std::ops::Range<usize>,
    range: crux_indexer_protocol::prompt_text::PromptTextRange,
) -> Option<crux_indexer_protocol::prompt_text::PromptTextNodeRef> {
    match link_type {
        LinkType::Inline => {
            let end = ranges::matching_end(events, event_index)?;
            let code_spans = events[event_index + 1..end]
                .iter()
                .filter_map(|(event, range)| matches!(event, Event::Code(_)).then(|| range.clone()))
                .collect::<Vec<_>>();
            let (_, destination_range) =
                ranges::inline_link(writer.text(), projected_range, &code_spans)?;
            let text_range = writer.map(ranges::content(events, event_index)?)?;
            let destination_range = writer.map(destination_range)?;
            let destination = destination.to_owned();
            let title = (!title.is_empty()).then(|| title.to_owned());
            Some(writer.link(|index, island| PromptTextLink::Inline {
                index,
                island,
                range,
                text_range,
                destination_range,
                destination,
                title,
            }))
        }
        LinkType::Autolink | LinkType::Email => {
            let text_range = writer.map(
                ranges::content(events, event_index)
                    .or_else(|| ranges::autolink(projected_range))?,
            )?;
            let destination = destination.to_owned();
            Some(writer.link(|index, island| PromptTextLink::Autolink {
                index,
                island,
                range,
                text_range,
                destination,
            }))
        }
        _ => None,
    }
}

fn inline_code(writer: &mut StructureWriter<'_>, projected: std::ops::Range<usize>) {
    let Some(range) = writer.map(projected.clone()) else {
        return;
    };
    let Some(text_range) =
        ranges::inline_code(writer.text(), projected).and_then(|text| writer.map(text))
    else {
        return;
    };
    writer.span(|index, island| PromptTextSpan::InlineCode {
        index,
        island,
        range,
        text_range,
    });
}

fn inline_html(writer: &mut StructureWriter<'_>, projected: std::ops::Range<usize>) {
    if let Some(range) = writer.map(projected) {
        writer.span(|index, island| PromptTextSpan::Html {
            index,
            island,
            range,
        });
    }
}

fn break_span(writer: &mut StructureWriter<'_>, projected: std::ops::Range<usize>, hard: bool) {
    let Some(range) = writer.map(projected) else {
        return;
    };
    if hard {
        writer.span(|index, island| PromptTextSpan::HardBreak {
            index,
            island,
            range,
        });
    } else {
        writer.span(|index, island| PromptTextSpan::SoftBreak {
            index,
            island,
            range,
        });
    }
}

fn thematic_break(writer: &mut StructureWriter<'_>, projected: std::ops::Range<usize>) {
    if let Some(range) = writer.map(projected) {
        writer.block(|index, island| PromptTextBlock::ThematicBreak {
            index,
            island,
            range,
        });
    }
}
