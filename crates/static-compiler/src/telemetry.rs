//! Telemetry helpers for the Static Index JSON-lines worker.

use serde_json::Value;

use crate::finalizer::run::StaticIndexFinalizeFactCounts;
use crate::protocol::static_index::{
    StaticIndexCacheTelemetry, StaticIndexFactTelemetry, StaticIndexFileTelemetry,
    StaticIndexNativeOnlyTelemetry, StaticIndexTelemetry, StaticIndexTiming,
};

pub(crate) fn telemetry(
    stage: &str,
    count: u64,
    files: StaticIndexFileTelemetry,
    cache: StaticIndexCacheTelemetry,
    facts: StaticIndexFactTelemetry,
) -> StaticIndexTelemetry {
    StaticIndexTelemetry {
        node: Default::default(),
        native_only: StaticIndexNativeOnlyTelemetry {
            reasons: vec!["phase-3-skeleton".to_string()],
            ..Default::default()
        },
        timings: vec![StaticIndexTiming {
            name: stage.to_string(),
            duration_ms: 0.0,
            count: Some(count),
        }],
        files,
        cache,
        facts,
    }
}

pub(crate) fn file_telemetry(
    selected: u64,
    cache_hits: u64,
    cache_misses: u64,
    analyzed: u64,
    skipped: u64,
) -> StaticIndexFileTelemetry {
    StaticIndexFileTelemetry {
        selected,
        cache_hits,
        cache_misses,
        analyzed,
        skipped,
    }
}

pub(crate) fn cache_telemetry(
    read_hits: u64,
    read_misses: u64,
    writes: u64,
) -> StaticIndexCacheTelemetry {
    StaticIndexCacheTelemetry {
        read_hits,
        read_misses,
        writes,
        ..Default::default()
    }
}

pub(crate) fn fact_telemetry_from_counts(
    counts: StaticIndexFinalizeFactCounts,
) -> StaticIndexFactTelemetry {
    StaticIndexFactTelemetry {
        definitions: counts.definitions as u64,
        relations: counts.relations as u64,
        source_refs: counts.source_refs as u64,
        diagnostics: counts.diagnostics as u64,
        lint_findings: counts.lint_findings as u64,
        rule_descriptors: counts.rule_descriptors as u64,
        sources: counts.sources as u64,
        source_graph: counts.source_graph as u64,
    }
}

pub(crate) fn count_fact_telemetry<'a>(
    values: impl Iterator<Item = &'a Value>,
) -> StaticIndexFactTelemetry {
    let mut facts = StaticIndexFactTelemetry::default();
    for value in values {
        match value.get("kind").and_then(Value::as_str) {
            Some("definition" | "definitions") => facts.definitions += 1,
            Some("relation" | "relations") => facts.relations += 1,
            Some("source-ref" | "sourceRef" | "sourceRefs" | "source_refs") => {
                facts.source_refs += 1
            }
            Some("diagnostic" | "diagnostics") => facts.diagnostics += 1,
            Some("lint-finding" | "lintFinding" | "lintFindings" | "lint_findings") => {
                facts.lint_findings += 1
            }
            Some("rule-descriptor" | "ruleDescriptor" | "ruleDescriptors" | "rule_descriptors") => {
                facts.rule_descriptors += 1
            }
            Some("source" | "sources") => facts.sources += 1,
            Some("source-graph" | "sourceGraph" | "source_graph") => facts.source_graph += 1,
            _ => {}
        }
    }
    facts
}
