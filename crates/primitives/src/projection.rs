//! First-party Static Index primitive projection.
//!
//! The Static Syntax frontend produces backend-neutral evidence. This module is
//! the public entry point that turns matched calls and initializers into Crux
//! primitive fact projections for Static Index compilation.
//!
//! Projection is driven by the [`crate::manifest`] first-party primitive
//! manifest: this file exposes the deep, stable entry points, while
//! [`dispatch`] walks the manifest to project each match. The gate is
//! intentionally strict — a primitive is either covered for its full supported
//! static extractor contract or it emits no native packet and falls back to the
//! TypeScript extension runtime. Partial "simple" packets are not allowed
//! because they hide coverage gaps and can suppress user extensions that
//! inspect the same source match.

mod dispatch;

use std::collections::HashMap;

use crate::protocol::{
    StaticImportRecord, StaticInitializerRecord, StaticNativeFactProjection, StaticSourceMatch,
    StaticSyntaxFileRecord,
};

/// Projects first-party static facts from a parsed Static Syntax record.
pub fn project_static_syntax_record(
    record: &StaticSyntaxFileRecord,
    source_text: &str,
) -> Vec<StaticNativeFactProjection> {
    project_static_syntax_record_with_records(record, source_text, None)
}

/// Projects first-party static facts from a parsed Static Syntax record.
///
/// `records_by_file` may include dependency records from the same Static Index
/// scope. When provided, primitive projectors can resolve supported imported
/// references without owning parsing or source loading.
pub fn project_static_syntax_record_with_records(
    record: &StaticSyntaxFileRecord,
    source_text: &str,
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Vec<StaticNativeFactProjection> {
    dispatch::project_first_party_facts(
        &record.file,
        source_text,
        &record.imports,
        &record.local_initializers,
        &record.matches,
        records_by_file,
    )
}

/// Projects first-party static facts from already extracted Static Syntax evidence.
pub fn project_native_facts(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    matches: &[StaticSourceMatch],
) -> Vec<StaticNativeFactProjection> {
    dispatch::project_first_party_facts(
        file,
        source_text,
        imports,
        local_initializers,
        matches,
        None,
    )
}

/// Projects first-party facts with optional records for selected dependency files.
pub fn project_native_facts_with_records(
    file: &str,
    source_text: &str,
    imports: &[StaticImportRecord],
    local_initializers: &[StaticInitializerRecord],
    matches: &[StaticSourceMatch],
    records_by_file: Option<&HashMap<String, StaticSyntaxFileRecord>>,
) -> Vec<StaticNativeFactProjection> {
    dispatch::project_first_party_facts(
        file,
        source_text,
        imports,
        local_initializers,
        matches,
        records_by_file,
    )
}
