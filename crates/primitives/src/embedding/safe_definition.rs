use serde_json::Value;

use crate::definition::{NativeDefinitionInput, static_index_definition};

/// Preserve snippet-derived identity while excluding authored text from snapshots.
pub(crate) fn byte_safe_embedding_definition(input: NativeDefinitionInput<'_>) -> Value {
    let mut definition = static_index_definition(input);
    if let Some(object) = definition.as_object_mut() {
        object.remove("sourceSnippet");
    }
    definition
}
