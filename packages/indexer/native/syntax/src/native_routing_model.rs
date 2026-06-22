use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::{
    native_definition::source_ref,
    native_record_values::{
        function_name_for_value, object_property, property_value, resolve_static_value,
        snippet_for_value, source_for_value,
    },
    protocol::{
        SourceLocation, SourceSnippet, StaticImportRecord, StaticInitializerRecord,
        StaticSourceMatch, StaticSyntaxValue,
    },
};

pub(crate) struct RoutingContext<'a> {
    pub file: &'a str,
    pub initializers: HashMap<&'a str, &'a StaticInitializerRecord>,
    imports: &'a [StaticImportRecord],
}

pub(crate) struct CallParts<'a> {
    pub variable_name: &'a str,
    pub callee_name: &'a str,
    pub callee_direct: Option<bool>,
    pub args: &'a [StaticSyntaxValue],
    pub object_arg: Option<&'a StaticSyntaxValue>,
    pub source: &'a SourceLocation,
    pub snippet: Option<&'a SourceSnippet>,
    local_initializers: &'a [StaticInitializerRecord],
}

struct ResolvedSource<'a> {
    symbol: String,
    value: &'a StaticSyntaxValue,
    source: SourceLocation,
    snippet: Option<SourceSnippet>,
    function_name: Option<String>,
}

enum ResolveOutcome<'a> {
    Resolved(ResolvedSource<'a>),
    Unresolved,
    NeedsImportedRecord,
}

impl<'a> RoutingContext<'a> {
    pub fn new(
        file: &'a str,
        imports: &'a [StaticImportRecord],
        local_initializers: &'a [StaticInitializerRecord],
        parts: &CallParts<'a>,
    ) -> Self {
        let initializers = local_initializers
            .iter()
            .chain(parts.local_initializers)
            .map(|item| (item.name.as_str(), item))
            .collect();
        Self {
            file,
            initializers,
            imports,
        }
    }

    fn resolve_value(&self, value: Option<&'a StaticSyntaxValue>) -> ResolveOutcome<'a> {
        self.resolve_value_seen(value, &mut HashSet::new())
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
            return ResolveOutcome::Resolved(resolved_from_initializer(symbol, initializer, value));
        }
        if self.imports.iter().any(|item| {
            item.local_name == symbol
                && item.imported_name != "default"
                && item.resolved_file.is_some()
        }) {
            return ResolveOutcome::NeedsImportedRecord;
        }
        ResolveOutcome::Unresolved
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
            value: current,
            source: source_for_value(current, property),
            snippet: snippet_for_value(current, None),
            function_name: function_name_for_value(current, path.last().map(String::as_str)),
        })
    }
}

pub(crate) fn call_parts(source_match: &StaticSourceMatch) -> Option<CallParts<'_>> {
    match source_match {
        StaticSourceMatch::Call {
            variable_name,
            callee,
            args,
            object_arg,
            source,
            snippet,
            local_initializers,
            ..
        } => Some(CallParts {
            variable_name,
            callee_name: &callee.name,
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

pub(crate) fn source_ref_for_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
) -> Option<Option<Value>> {
    match context.resolve_value(property_value(object, property)) {
        ResolveOutcome::NeedsImportedRecord => None,
        ResolveOutcome::Unresolved => Some(None),
        ResolveOutcome::Resolved(resolved) => {
            if !matches!(resolved.value, StaticSyntaxValue::Function { .. }) {
                return Some(None);
            }
            Some(Some(source_ref(
                definition_id,
                property,
                &resolved.symbol,
                &resolved.source,
                resolved.function_name.as_deref(),
                resolved.snippet.as_ref(),
            )))
        }
    }
}

fn resolved_from_initializer<'a>(
    symbol: &str,
    initializer: &'a StaticInitializerRecord,
    value: &'a StaticSyntaxValue,
) -> ResolvedSource<'a> {
    ResolvedSource {
        symbol: symbol.to_string(),
        value,
        source: initializer.source.clone(),
        snippet: snippet_for_value(value, Some(initializer)),
        function_name: function_name_for_value(value, Some(symbol)),
    }
}
