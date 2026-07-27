use std::ops::Range;

use crux_indexer_protocol::prompt_text::{
    PromptTextBlock, PromptTextLink, PromptTextNesting, PromptTextNodeRef, PromptTextRange,
    PromptTextSpan, PromptTextTemplate,
};
use crux_indexer_syntax_oxc::prompt_text::{ProjectedTextIsland, map_projected_range};
use pulldown_cmark::HeadingLevel;

#[derive(Debug)]
struct Frame {
    node: Option<PromptTextNodeRef>,
    next_child: u32,
}

/// Writes normalized records while keeping indices and nesting deterministic.
pub(crate) struct StructureWriter<'a> {
    source: &'a str,
    island: &'a ProjectedTextIsland,
    template: &'a mut PromptTextTemplate,
    stack: Vec<Frame>,
}

impl<'a> StructureWriter<'a> {
    pub(crate) fn new(
        source: &'a str,
        island: &'a ProjectedTextIsland,
        template: &'a mut PromptTextTemplate,
    ) -> Self {
        Self {
            source,
            island,
            template,
            stack: Vec::new(),
        }
    }

    pub(crate) fn text(&self) -> &str {
        &self.island.text
    }

    pub(crate) fn map(&self, range: Range<usize>) -> Option<PromptTextRange> {
        map_projected_range(self.source, self.island, range)
    }

    pub(crate) fn begin(&mut self, node: Option<PromptTextNodeRef>) {
        self.stack.push(Frame {
            node,
            next_child: 0,
        });
    }

    pub(crate) fn end(&mut self) {
        self.stack.pop();
    }

    pub(crate) fn block(
        &mut self,
        make: impl FnOnce(u32, u32) -> PromptTextBlock,
    ) -> PromptTextNodeRef {
        let index = self.template.blocks.len() as u32;
        let node = PromptTextNodeRef::Block { index };
        self.attach(node.clone());
        self.template.blocks.push(make(index, self.island.index));
        node
    }

    pub(crate) fn span(
        &mut self,
        make: impl FnOnce(u32, u32) -> PromptTextSpan,
    ) -> PromptTextNodeRef {
        let index = self.template.spans.len() as u32;
        let node = PromptTextNodeRef::Span { index };
        self.attach(node.clone());
        self.template.spans.push(make(index, self.island.index));
        node
    }

    pub(crate) fn link(
        &mut self,
        make: impl FnOnce(u32, u32) -> PromptTextLink,
    ) -> PromptTextNodeRef {
        let index = self.template.links.len() as u32;
        let node = PromptTextNodeRef::Link { index };
        self.attach(node.clone());
        self.template.links.push(make(index, self.island.index));
        node
    }

    fn attach(&mut self, child: PromptTextNodeRef) {
        let Some(parent) = self
            .stack
            .iter_mut()
            .rev()
            .find(|frame| frame.node.is_some())
        else {
            return;
        };
        let ordinal = parent.next_child;
        parent.next_child += 1;
        self.template.nesting.push(PromptTextNesting {
            parent: parent.node.clone().expect("checked above"),
            child,
            ordinal,
        });
    }
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
