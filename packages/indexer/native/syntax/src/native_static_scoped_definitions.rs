//! Source-scoped definition aliases for native static relation binding.
//!
//! TypeScript binds static relation refs with a file-local map plus imported definitions. Native
//! finalization receives project-wide grouped facts, so analyze enriches relation refs with scoped
//! target ids before that file boundary disappears.

use std::collections::HashMap;

use serde_json::Value;

use crate::protocol::{StaticNativeFactProjection, StaticSyntaxFileRecord};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScopedDefinition {
    pub id: String,
    pub kind: String,
    pub name: String,
}

pub(crate) fn scoped_definitions_by_variable(
    record: &StaticSyntaxFileRecord,
    native_facts: &[StaticNativeFactProjection],
    records_by_file: &HashMap<String, StaticSyntaxFileRecord>,
) -> HashMap<String, ScopedDefinition> {
    let mut definitions = definitions_by_variable(native_facts);
    for import in record
        .imports
        .iter()
        .filter(|import| import.imported_name != "default")
    {
        let Some(imported_record) = import
            .resolved_file
            .as_ref()
            .and_then(|file| records_by_file.get(file))
        else {
            continue;
        };
        let imported_definitions = definitions_by_variable(&imported_record.native_facts);
        if let Some(definition) = imported_definitions.get(&import.imported_name) {
            definitions.insert(import.local_name.clone(), definition.clone());
        }
    }
    definitions
}

fn definitions_by_variable(
    native_facts: &[StaticNativeFactProjection],
) -> HashMap<String, ScopedDefinition> {
    native_facts
        .iter()
        .flat_map(|projection| fact_definitions_by_variable(&projection.facts))
        .collect()
}

fn fact_definitions_by_variable(facts: &Value) -> Vec<(String, ScopedDefinition)> {
    facts
        .get("definitions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let variable_name = entry.get("variableName")?.as_str()?.to_string();
            let definition = scoped_definition(entry.get("definition")?)?;
            Some((variable_name, definition))
        })
        .collect()
}

fn scoped_definition(definition: &Value) -> Option<ScopedDefinition> {
    Some(ScopedDefinition {
        id: definition.get("id")?.as_str()?.to_string(),
        kind: definition.get("kind")?.as_str()?.to_string(),
        name: definition.get("name")?.as_str()?.to_string(),
    })
}
