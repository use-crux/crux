use crux_indexer_protocol::prompt_text::{PromptTextPreview, PromptTextTemplate};

pub(crate) fn retain_empty_preview(template: &mut PromptTextTemplate) {
    template.preview = PromptTextPreview::default();
}
