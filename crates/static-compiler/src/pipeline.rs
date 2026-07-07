//! Stage facade for the static Project Index compiler.
//!
//! `worker` owns JSON-lines IO. This module owns the stage-level compiler
//! behavior and returns protocol-shaped values without writing to stdout.

use serde_json::Value;

use crate::analysis::run::StaticIndexAnalysisFacts;
use crate::analysis::run::analyze_static_index_facts;
use crate::core::evidence::extension_evidence_jobs;
use crate::finalizer::events::{
    StaticIndexFinalizeEventOptions, project_from_fact_values, project_patch_events,
};
use crate::finalizer::run::finalize_static_index_values_with_lint_facts;
use crate::lints::filter::{
    StaticIndexLintOptions, StaticIndexLintSuppression as PreparedLintSuppression,
};
use crate::protocol::static_index::{
    STATIC_INDEX_PROTOCOL_VERSION, StaticIndexAnalyzeRequest, StaticIndexAnalyzeResponse,
    StaticIndexCompileRequest, StaticIndexFactTelemetry, StaticIndexFinalizeRequest,
    StaticIndexFinalizeResponse, StaticIndexMethod, StaticIndexPlan, StaticIndexPrepareRequest,
    StaticIndexPrepareResponse,
};
use crate::relation::model::relation_policy_table_from_value_with_builtins;
use crate::telemetry::{
    cache_telemetry, count_fact_telemetry, fact_telemetry_from_counts, file_telemetry, telemetry,
};

/// Static Index analyze output before JSON-lines streaming.
pub struct StaticIndexAnalyzeOutput {
    pub extension_evidence_jobs: Vec<Value>,
    fact_groups: StaticIndexAnalysisFacts,
    pub response: StaticIndexAnalyzeResponse,
}

impl StaticIndexAnalyzeOutput {
    /// Consume the compiler output and return worker-stream-ready values.
    pub fn into_wire_parts(self) -> (Vec<Value>, Vec<Value>, StaticIndexAnalyzeResponse) {
        (
            self.extension_evidence_jobs,
            self.fact_groups.into_wire_values(),
            self.response,
        )
    }
}

/// Prepare a Static Index plan from selected source files and cache identity.
pub fn prepare(request: StaticIndexPrepareRequest) -> StaticIndexPrepareResponse {
    let files = request.files;
    let primary_files = request.primary_files.unwrap_or_else(|| files.clone());
    let cache_hits = files
        .iter()
        .filter(|file| file.cache_key.is_some())
        .cloned()
        .collect::<Vec<_>>();
    let cache_misses = files
        .iter()
        .filter(|file| file.cache_key.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let selected = files.len() as u64;
    let hit_count = cache_hits.len() as u64;
    let miss_count = cache_misses.len() as u64;

    StaticIndexPrepareResponse {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        method: StaticIndexMethod::Prepare,
        plan: StaticIndexPlan {
            root: request.root,
            project_name: request.project_name,
            files,
            primary_files: Some(primary_files),
            cache_hits,
            cache_misses,
            call_names: request.call_names,
            call_interests: request.call_interests,
            constructor_names: request.constructor_names,
            constructor_interests: request.constructor_interests,
            prune_native_fact_call_names: request.prune_native_fact_call_names,
        },
        diagnostics: Vec::new(),
        telemetry: telemetry(
            "prepare",
            selected,
            file_telemetry(selected, hit_count, miss_count, 0, selected),
            cache_telemetry(hit_count, miss_count, 0),
            StaticIndexFactTelemetry::default(),
        ),
    }
}

/// Analyze prepared files into Static Index facts and extension evidence jobs.
pub fn analyze(request: &StaticIndexAnalyzeRequest) -> StaticIndexAnalyzeOutput {
    let extension_evidence_jobs = extension_evidence_jobs(request);
    let facts = analyze_static_index_facts(request);
    let selected = request.plan.files.len() as u64;
    let cache_hits = request.plan.cache_hits.len() as u64;
    let cache_misses = request.plan.cache_misses.len() as u64;
    let analyzed = request.files.len() as u64;
    let skipped = selected.saturating_sub(analyzed);

    StaticIndexAnalyzeOutput {
        extension_evidence_jobs,
        fact_groups: facts,
        response: StaticIndexAnalyzeResponse {
            protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
            method: StaticIndexMethod::Analyze,
            facts: Vec::new(),
            diagnostics: Vec::new(),
            extension_evidence_jobs: Vec::new(),
            telemetry: telemetry(
                "analyze",
                analyzed,
                file_telemetry(selected, cache_hits, cache_misses, analyzed, skipped),
                cache_telemetry(cache_hits, cache_misses, 0),
                StaticIndexFactTelemetry::default(),
            ),
        },
    }
}

/// Finalize native and extension facts into Project Index patch events.
pub fn finalize(request: StaticIndexFinalizeRequest) -> StaticIndexFinalizeResponse {
    let policies = relation_policy_table_from_value_with_builtins(request.relation_specs.as_ref());
    let lint_options = StaticIndexLintOptions {
        emit_builtin_lints: request.emit_builtin_lints.unwrap_or(true),
        config: request.lint_config.clone(),
        suppressions: request
            .lint_suppressions
            .iter()
            .map(|suppression| PreparedLintSuppression {
                file: suppression.file.clone(),
                line: suppression.line,
                column: suppression.column,
                scope: suppression.scope.clone(),
                rule_id: suppression.rule_id.clone(),
            })
            .collect(),
    };
    let finalized = finalize_static_index_values_with_lint_facts(
        &request.native_facts,
        &request.extension_facts,
        &request.lint_facts,
        &policies,
        &lint_options,
    );
    let fact_count = finalized
        .counts
        .total()
        .max(request.native_facts.len() + request.extension_facts.len() + request.lint_facts.len());
    let facts = if finalized.counts.is_empty() {
        count_fact_telemetry(
            request
                .native_facts
                .iter()
                .chain(request.extension_facts.iter())
                .chain(request.lint_facts.iter()),
        )
    } else {
        fact_telemetry_from_counts(finalized.counts)
    };
    let writes = request
        .cache
        .as_ref()
        .and_then(|cache| cache.get("writes"))
        .and_then(Value::as_array)
        .map(|writes| writes.len() as u64)
        .unwrap_or(0);

    let patch_phase = request.patch_phase.as_deref().unwrap_or("ast");
    let default_invalidates = (patch_phase == "ast").then(|| serde_json::json!({ "all": true }));
    let patch_invalidates = request
        .patch_invalidates
        .as_ref()
        .or(default_invalidates.as_ref());

    let project = project_from_fact_values(&request.native_facts)
        .or_else(|| project_from_fact_values(&request.extension_facts))
        .or_else(|| project_from_fact_values(&request.lint_facts));
    let events = project
        .as_ref()
        .map(|project| {
            project_patch_events(
                &finalized,
                project,
                &request.identity.compiler.version,
                StaticIndexFinalizeEventOptions {
                    phase: patch_phase,
                    invalidates: patch_invalidates,
                },
            )
        })
        .unwrap_or_default();

    StaticIndexFinalizeResponse {
        protocol_version: STATIC_INDEX_PROTOCOL_VERSION,
        method: StaticIndexMethod::Finalize,
        events,
        telemetry: telemetry(
            "finalize",
            fact_count as u64,
            file_telemetry(0, 0, 0, 0, 0),
            cache_telemetry(0, 0, writes),
            facts,
        ),
    }
}

/// Analyze and finalize a native-only compile request in one pipeline call.
pub fn compile(request: StaticIndexCompileRequest) -> StaticIndexFinalizeResponse {
    let analyze_request = StaticIndexAnalyzeRequest {
        protocol_version: request.protocol_version,
        method: StaticIndexMethod::Analyze,
        stream: true,
        identity: request.identity.clone(),
        plan: request.plan,
        files: request.files,
        extension_evidence_interests: None,
    };
    let mut native_facts = request.native_facts;
    native_facts.extend(analyze(&analyze_request).fact_groups.into_wire_values());

    let finalize_request = StaticIndexFinalizeRequest {
        protocol_version: request.protocol_version,
        method: StaticIndexMethod::Finalize,
        stream: true,
        identity: request.identity,
        native_facts,
        extension_facts: request.extension_facts,
        lint_facts: Vec::new(),
        relation_specs: request.relation_specs,
        rule_results: None,
        lint_config: request.lint_config,
        lint_suppressions: request.lint_suppressions,
        emit_builtin_lints: request.emit_builtin_lints,
        patch_phase: None,
        patch_invalidates: request.patch_invalidates,
        cache: None,
    };

    let mut response = finalize(finalize_request);
    response.method = StaticIndexMethod::Compile;
    response
}
