//! Data-only Rust ABI shapes for the Static Index compiler protocol.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{StaticSyntaxCallInterest, StaticSyntaxConstructorInterest};

/// Current Static Index compiler protocol version.
pub const STATIC_INDEX_PROTOCOL_VERSION: u8 = 2;

/// Method string for Static Index planning.
pub const STATIC_INDEX_PREPARE_METHOD: &str = "staticIndexPrepare";

/// Method string for Static Index file analysis.
pub const STATIC_INDEX_ANALYZE_METHOD: &str = "staticIndexAnalyze";

/// Method string for Static Index final patch/event materialization.
pub const STATIC_INDEX_FINALIZE_METHOD: &str = "staticIndexFinalize";

/// Method string for streamed Static Index compile.
pub const STATIC_INDEX_COMPILE_METHOD: &str = "staticIndexCompile";

/// Static Index compiler method discriminator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StaticIndexMethod {
    #[serde(rename = "staticIndexPrepare")]
    Prepare,
    #[serde(rename = "staticIndexAnalyze")]
    Analyze,
    #[serde(rename = "staticIndexFinalize")]
    Finalize,
    #[serde(rename = "staticIndexCompile")]
    Compile,
}

/// Complete identity for a Static Index compiler run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexRunIdentity {
    pub protocol_version: u8,
    pub compiler: StaticIndexVersionIdentity,
    pub oxc: StaticIndexVersionIdentity,
    pub primitive_manifest: StaticIndexDigestIdentity,
    pub relation_policy: StaticIndexDigestIdentity,
    pub extension_manifests: Vec<StaticIndexDigestIdentity>,
    pub rule_descriptors: StaticIndexDigestIdentity,
    pub compiler_projection: StaticIndexDigestIdentity,
}

/// Name/version identity for compiler-owned components.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexVersionIdentity {
    pub name: String,
    pub version: String,
}

/// Name/version identity with an optional digest for cache-sensitive inputs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexDigestIdentity {
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

/// Compiler-owned Static Index identity manifest before project extension input is added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexIdentityManifest {
    pub protocol_version: u8,
    pub compiler: StaticIndexVersionIdentity,
    pub oxc_frontend: StaticIndexVersionIdentity,
    pub primitive_manifest: StaticIndexDigestIdentity,
    pub relation_policy: StaticIndexDigestIdentity,
    pub rule_descriptors: StaticIndexDigestIdentity,
    pub compiler_projection: StaticIndexDigestIdentity,
}

/// Cross-stage telemetry for one Static Index compiler run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexTelemetry {
    pub node: StaticIndexNodeTelemetry,
    pub native_only: StaticIndexNativeOnlyTelemetry,
    pub timings: Vec<StaticIndexTiming>,
    pub files: StaticIndexFileTelemetry,
    pub cache: StaticIndexCacheTelemetry,
    pub facts: StaticIndexFactTelemetry,
}

/// Whether Node started, plus machine-readable reasons when it did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexNodeTelemetry {
    pub started: bool,
    pub reasons: Vec<String>,
}

/// Whether the run was eligible for native-only execution.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexNativeOnlyTelemetry {
    pub eligible: bool,
    pub reasons: Vec<String>,
}

/// Named timing measurement. `count` is for batched work such as files or jobs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexTiming {
    pub name: String,
    pub duration_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

/// File counts reported by prepare/analyze/finalize.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexFileTelemetry {
    pub selected: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub analyzed: u64,
    pub skipped: u64,
}

/// Static cache counters for the run.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexCacheTelemetry {
    pub read_hits: u64,
    pub read_misses: u64,
    pub writes: u64,
    pub write_errors: u64,
}

/// Project Index fact counters emitted by the run.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexFactTelemetry {
    pub definitions: u64,
    pub relations: u64,
    pub source_refs: u64,
    pub diagnostics: u64,
    pub lint_findings: u64,
    pub rule_descriptors: u64,
    pub sources: u64,
    pub source_graph: u64,
}

/// Selected source file identity used by prepare and prepared plans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceFile {
    pub file: String,
    pub source_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_key: Option<String>,
}

/// Prepared source plan passed from prepare into analyze.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexPlan {
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub files: Vec<StaticIndexSourceFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_files: Option<Vec<StaticIndexSourceFile>>,
    pub cache_hits: Vec<StaticIndexSourceFile>,
    pub cache_misses: Vec<StaticIndexSourceFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub call_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constructor_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prune_native_fact_call_names: Vec<String>,
}

/// Analyze-stage file payload. `sourceText` is present when Rust cannot read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexAnalyzeFile {
    pub file: String,
    pub source_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_text: Option<String>,
}

/// Prepared Static Index lint suppression directive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexLintSuppression {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub scope: String,
    pub rule_id: String,
}

/// `staticIndexPrepare` request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexPrepareRequest {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    pub identity: StaticIndexRunIdentity,
    pub files: Vec<StaticIndexSourceFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_files: Option<Vec<StaticIndexSourceFile>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub call_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constructor_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prune_native_fact_call_names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_inputs: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_host: Option<Value>,
}

/// `staticIndexPrepare` response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexPrepareResponse {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    pub plan: StaticIndexPlan,
    pub diagnostics: Vec<Value>,
    pub telemetry: StaticIndexTelemetry,
}

/// `staticIndexAnalyze` request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexAnalyzeRequest {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    pub identity: StaticIndexRunIdentity,
    pub plan: StaticIndexPlan,
    pub files: Vec<StaticIndexAnalyzeFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_evidence_interests: Option<Value>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// `staticIndexAnalyze` response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexAnalyzeResponse {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    pub facts: Vec<Value>,
    pub diagnostics: Vec<Value>,
    pub extension_evidence_jobs: Vec<Value>,
    pub telemetry: StaticIndexTelemetry,
}

/// `staticIndexCompile` request for native-only AST indexing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexCompileRequest {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    pub identity: StaticIndexRunIdentity,
    pub plan: StaticIndexPlan,
    pub files: Vec<StaticIndexAnalyzeFile>,
    pub native_facts: Vec<Value>,
    pub extension_facts: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation_specs: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lint_config: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint_suppressions: Vec<StaticIndexLintSuppression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emit_builtin_lints: Option<bool>,
}

/// `staticIndexFinalize` request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexFinalizeRequest {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    pub identity: StaticIndexRunIdentity,
    pub native_facts: Vec<Value>,
    pub extension_facts: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint_facts: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation_specs: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_results: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lint_config: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint_suppressions: Vec<StaticIndexLintSuppression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emit_builtin_lints: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_invalidates: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<Value>,
}

/// `staticIndexFinalize` response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexFinalizeResponse {
    pub protocol_version: u8,
    pub method: StaticIndexMethod,
    pub events: Vec<Value>,
    pub telemetry: StaticIndexTelemetry,
}
