//! Shared context for first-party extractor projection.
//!
//! Syntax parsing produces source evidence only. Extractor projection uses
//! this context to resolve local and imported static values while building
//! compiler-owned facts.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::{
    protocol::{
        SourceLocation, SourceSnippet, StaticImportRecord, StaticInitializerRecord,
        StaticSourceMatch, StaticSyntaxFileRecord, StaticSyntaxValue,
    },
    record_values::{
        function_name_for_value, object_property, resolve_static_value, snippet_for_value,
        source_for_value,
    },
};

pub(crate) use crate::routing::source_refs::{
    source_ref_for_callback_property, source_ref_for_property, source_ref_for_static_property,
};

pub(crate) mod facts;

pub(crate) struct PrimitiveContext<'a> {
    pub file: &'a str,
    pub fingerprint_file: &'a str,
    pub initializers: HashMap<&'a str, &'a StaticInitializerRecord>,
    imports: &'a [StaticImportRecord],
    records_by_file: Option<&'a HashMap<String, StaticSyntaxFileRecord>>,
}

pub(crate) struct CallParts<'a> {
    pub match_kind: &'static str,
    pub variable_name: &'a str,
    pub owner_variable_name: Option<&'a str>,
    pub local_name: &'a str,
    pub exported: bool,
    pub eager_execution: bool,
    pub callee_name: &'a str,
    pub callee_local_name: Option<&'a str>,
    pub receiver_name: Option<&'a str>,
    pub callee_module_specifier: Option<&'a str>,
    pub callee_direct: Option<bool>,
    pub args: &'a [StaticSyntaxValue],
    pub object_arg: Option<&'a StaticSyntaxValue>,
    pub source: &'a SourceLocation,
    pub snippet: Option<&'a SourceSnippet>,
    local_initializers: &'a [StaticInitializerRecord],
}

impl CallParts<'_> {
    /// Records proof that the definition is authored by a direct named export.
    ///
    /// Absence is intentional for local declarations and indirect export
    /// statements, whose cross-file visibility cannot be proven by this pass.
    pub(crate) fn add_direct_export_evidence(&self, metadata: &mut Map<String, Value>) {
        if self.has_direct_export_evidence() {
            metadata.insert("exported".to_string(), Value::Bool(true));
        }
    }

    /// Whether this call or constructor has module-qualified export proof.
    pub(crate) fn has_direct_export_evidence(&self) -> bool {
        self.exported
            && crate::producer_identity::is_first_party_producer(
                self.match_kind,
                self.callee_name,
                self.callee_module_specifier,
            )
    }
}

pub(crate) struct ResolvedSource<'a> {
    pub symbol: String,
    pub definition_symbol: String,
    pub fingerprint_file: String,
    pub value: &'a StaticSyntaxValue,
    pub source: SourceLocation,
    pub snippet: Option<SourceSnippet>,
    pub function_name: Option<String>,
}

enum ResolveOutcome<'a> {
    Resolved(ResolvedSource<'a>),
    Unresolved,
    NeedsImportedRecord,
}

impl<'a> PrimitiveContext<'a> {
    pub fn new(
        file: &'a str,
        fingerprint_file: &'a str,
        imports: &'a [StaticImportRecord],
        local_initializers: &'a [StaticInitializerRecord],
        parts: &CallParts<'a>,
    ) -> Self {
        Self::from_initializers(
            file,
            fingerprint_file,
            imports,
            local_initializers,
            parts.local_initializers,
        )
    }

    pub fn new_with_records(
        file: &'a str,
        fingerprint_file: &'a str,
        imports: &'a [StaticImportRecord],
        local_initializers: &'a [StaticInitializerRecord],
        parts: &CallParts<'a>,
        records_by_file: Option<&'a HashMap<String, StaticSyntaxFileRecord>>,
    ) -> Self {
        Self::from_initializers_with_records(
            file,
            fingerprint_file,
            imports,
            local_initializers,
            parts.local_initializers,
            records_by_file,
        )
    }

    pub(crate) fn from_initializers(
        file: &'a str,
        fingerprint_file: &'a str,
        imports: &'a [StaticImportRecord],
        local_initializers: &'a [StaticInitializerRecord],
        match_initializers: &'a [StaticInitializerRecord],
    ) -> Self {
        Self::from_initializers_with_records(
            file,
            fingerprint_file,
            imports,
            local_initializers,
            match_initializers,
            None,
        )
    }

    pub(crate) fn from_initializers_with_records(
        file: &'a str,
        fingerprint_file: &'a str,
        imports: &'a [StaticImportRecord],
        local_initializers: &'a [StaticInitializerRecord],
        match_initializers: &'a [StaticInitializerRecord],
        records_by_file: Option<&'a HashMap<String, StaticSyntaxFileRecord>>,
    ) -> Self {
        let initializers = local_initializers
            .iter()
            .chain(match_initializers)
            .map(|item| (item.name.as_str(), item))
            .collect();
        Self {
            file,
            fingerprint_file,
            initializers,
            imports,
            records_by_file,
        }
    }

    fn resolve_value(&self, value: Option<&'a StaticSyntaxValue>) -> ResolveOutcome<'a> {
        self.resolve_value_seen(value, &mut HashSet::new())
    }

    pub(crate) fn resolve_record_source(
        &self,
        value: Option<&'a StaticSyntaxValue>,
    ) -> Option<Option<ResolvedSource<'a>>> {
        match self.resolve_value(value) {
            ResolveOutcome::Resolved(source) => Some(Some(source)),
            ResolveOutcome::Unresolved => Some(None),
            ResolveOutcome::NeedsImportedRecord => None,
        }
    }

    fn resolve_value_seen(
        &self,
        value: Option<&'a StaticSyntaxValue>,
        seen: &mut HashSet<String>,
    ) -> ResolveOutcome<'a> {
        match value {
            Some(StaticSyntaxValue::Identifier { name }) => self.resolve_identifier(name, seen),
            Some(StaticSyntaxValue::PropertyAccess { path, .. }) => {
                self.resolve_property_access(path, seen)
            }
            _ => ResolveOutcome::Unresolved,
        }
    }

    fn resolve_identifier(&self, symbol: &str, seen: &mut HashSet<String>) -> ResolveOutcome<'a> {
        if let Some(initializer) = self.initializers.get(symbol) {
            if matches!(initializer.value, StaticSyntaxValue::Identifier { .. })
                && !seen.insert(symbol.to_string())
            {
                return ResolveOutcome::Unresolved;
            }
            let value = resolve_static_value(&initializer.value, &self.initializers, seen);
            return ResolveOutcome::Resolved(resolved_from_initializer(
                symbol,
                self.fingerprint_file,
                initializer,
                value,
            ));
        }
        let Some(import) = self.imports.iter().find(|item| {
            item.local_name == symbol
                && item.imported_name != "default"
                && item.resolved_file.is_some()
        }) else {
            return ResolveOutcome::Unresolved;
        };
        let Some(resolved) = self.resolve_imported_identifier(symbol, import, seen) else {
            return ResolveOutcome::NeedsImportedRecord;
        };
        ResolveOutcome::Resolved(resolved)
    }

    fn resolve_imported_identifier(
        &self,
        symbol: &str,
        import: &StaticImportRecord,
        seen: &mut HashSet<String>,
    ) -> Option<ResolvedSource<'a>> {
        let records_by_file = self.records_by_file?;
        let imported_record = records_by_file.get(import.resolved_file.as_ref()?)?;
        let imported_initializer = imported_record
            .local_initializers
            .iter()
            .find(|initializer| initializer.name == import.imported_name)?;
        let imported_initializers = imported_record
            .local_initializers
            .iter()
            .map(|item| (item.name.as_str(), item))
            .collect::<HashMap<_, _>>();
        let value = resolve_static_value(&imported_initializer.value, &imported_initializers, seen);
        Some(resolved_from_initializer(
            symbol,
            &imported_record.relative_path,
            imported_initializer,
            value,
        ))
    }

    fn resolve_property_access(
        &self,
        path: &'a [String],
        seen: &mut HashSet<String>,
    ) -> ResolveOutcome<'a> {
        let Some((root, properties)) = path.split_first() else {
            return ResolveOutcome::Unresolved;
        };
        let root_source = match self.resolve_identifier(root, seen) {
            ResolveOutcome::Resolved(source) => source,
            other => return other,
        };
        let mut current = resolve_static_value(root_source.value, &self.initializers, seen);
        let mut current_property = None;
        for property_name in properties {
            let Some(property) = object_property(current, property_name) else {
                return ResolveOutcome::Unresolved;
            };
            current_property = Some(property);
            current = resolve_static_value(&property.value, &self.initializers, seen);
        }
        let Some(property) = current_property else {
            return ResolveOutcome::Unresolved;
        };
        ResolveOutcome::Resolved(ResolvedSource {
            symbol: path.join("."),
            definition_symbol: root_source.definition_symbol,
            fingerprint_file: root_source.fingerprint_file,
            value: current,
            source: source_for_value(current, property),
            snippet: snippet_for_value(current, None),
            function_name: function_name_for_value(current, path.last().map(String::as_str)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::PrimitiveContext;

    #[test]
    fn keeps_absolute_source_and_relative_fingerprint_identity_separate() {
        let context = PrimitiveContext::from_initializers(
            "/tmp/checkout/src/catalog.ts",
            "src/catalog.ts",
            &[],
            &[],
            &[],
        );
        assert_eq!(context.file, "/tmp/checkout/src/catalog.ts");
        assert_eq!(context.fingerprint_file, "src/catalog.ts");
    }
}

pub(crate) fn call_parts(source_match: &StaticSourceMatch) -> Option<CallParts<'_>> {
    match source_match {
        StaticSourceMatch::Call {
            variable_name,
            owner_variable_name,
            local_name,
            exported,
            eager_execution,
            callee,
            args,
            object_arg,
            source,
            snippet,
            local_initializers,
            ..
        } => Some(CallParts {
            match_kind: "call",
            variable_name,
            owner_variable_name: owner_variable_name.as_deref(),
            local_name,
            exported: *exported,
            eager_execution: *eager_execution,
            callee_name: &callee.name,
            callee_local_name: callee.local_name.as_deref(),
            receiver_name: callee.receiver_name.as_deref(),
            callee_module_specifier: callee.module_specifier.as_deref(),
            callee_direct: callee.direct,
            args,
            object_arg: object_arg.as_ref(),
            source,
            snippet: snippet.as_ref(),
            local_initializers,
        }),
        StaticSourceMatch::New {
            variable_name,
            owner_variable_name,
            local_name,
            exported,
            callee,
            args,
            object_arg,
            source,
            snippet,
            local_initializers,
            ..
        } => Some(CallParts {
            match_kind: "new",
            variable_name,
            owner_variable_name: owner_variable_name.as_deref(),
            local_name,
            exported: *exported,
            eager_execution: false,
            callee_name: &callee.name,
            callee_local_name: callee.local_name.as_deref(),
            receiver_name: callee.receiver_name.as_deref(),
            callee_module_specifier: callee.module_specifier.as_deref(),
            callee_direct: callee.direct,
            args,
            object_arg: object_arg.as_ref(),
            source,
            snippet: snippet.as_ref(),
            local_initializers,
        }),
        _ => None,
    }
}

fn resolved_from_initializer<'a>(
    symbol: &str,
    fingerprint_file: &str,
    initializer: &'a StaticInitializerRecord,
    value: &'a StaticSyntaxValue,
) -> ResolvedSource<'a> {
    ResolvedSource {
        symbol: symbol.to_string(),
        definition_symbol: initializer.name.clone(),
        fingerprint_file: fingerprint_file.to_string(),
        value,
        source: initializer.source.clone(),
        snippet: snippet_for_value(value, Some(initializer)),
        function_name: function_name_for_value(value, Some(symbol)),
    }
}
