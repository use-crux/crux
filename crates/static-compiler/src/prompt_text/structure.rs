use std::ops::Range;

use crux_indexer_protocol::prompt_text::PromptTextBlock;
use crux_indexer_syntax_oxc::prompt_text::{ProjectedTextIsland, map_projected_range};
use pulldown_cmark::HeadingLevel;

pub(crate) fn heading(
    source: &str,
    island: &ProjectedTextIsland,
    index: u32,
    level: u8,
    range: Range<usize>,
    text_range: Range<usize>,
) -> Option<PromptTextBlock> {
    Some(PromptTextBlock::Heading {
        index,
        island: island.index,
        level,
        range: map_projected_range(source, island, range)?,
        text_range: map_projected_range(source, island, text_range)?,
    })
}

pub(crate) fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}
