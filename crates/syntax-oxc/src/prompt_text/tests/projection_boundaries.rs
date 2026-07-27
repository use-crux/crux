use crux_indexer_protocol::prompt_text::PromptTextAnalysisStatus;

use super::{project, request};

#[test]
fn keeps_outer_quasis_around_a_nested_template_interpolation() {
    let source = concat!(
        "const name = 'Ada'; const value = md`\r\n",
        "  # Héllo **team**\r\n",
        "  > 👋 *Welcome*${/* opaque } */ ({ nested: `inner ${name}` })}\r\n",
        "  - Read [guide](https://example.com) and \\`code\\`\r\n",
        "`;"
    );

    let projected = project(&request(source));

    assert_eq!(projected.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(projected.templates.len(), 1);
    assert_eq!(
        projected.templates[0].template.status,
        PromptTextAnalysisStatus::Complete
    );
}
