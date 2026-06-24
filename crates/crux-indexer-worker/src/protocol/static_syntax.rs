use serde::Serialize;
use serde_json::Value;

pub use crate::protocol::worker::{
    BatchWorkerRequest, SingleWorkerRequest, WorkerRequest, WorkerResponse, WorkerStreamEvent,
};

pub const FRONTEND_NAME: &str = "oxc-rust";
pub const FRONTEND_VERSION: &str = "oxc_parser@0.133.0+crux_native_group3.5";

#[derive(Debug)]
pub struct ParseRequest {
    pub root: String,
    pub file: String,
    pub source: String,
    pub call_names: Vec<String>,
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    pub constructor_names: Vec<String>,
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    pub prune_native_fact_call_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticSyntaxCallInterest {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub import_from: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_arg: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub callbacks: Vec<StaticSyntaxCallbackInterest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticSyntaxConstructorInterest {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub import_from: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_arg: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub callbacks: Vec<StaticSyntaxCallbackInterest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticSyntaxCallbackInterest {
    pub property: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticSyntaxFileRecord {
    pub schema_version: u8,
    pub frontend: StaticSyntaxFrontendIdentity,
    pub file: String,
    pub source_hash: String,
    pub imports: Vec<StaticImportRecord>,
    pub matches: Vec<StaticSourceMatch>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub native_facts: Vec<StaticNativeFactProjection>,
    pub local_initializers: Vec<StaticInitializerRecord>,
    pub diagnostics: Vec<IndexDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticNativeFactProjection {
    pub match_index: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub replaces: Vec<StaticNativeFactExtractorIdentity>,
    pub facts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticNativeFactExtractorIdentity {
    pub extension: String,
    pub extractor: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticSyntaxFrontendIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticImportRecord {
    pub local_name: String,
    pub imported_name: String,
    pub module_specifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_file: Option<String>,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticInitializerRecord {
    pub name: String,
    pub value: StaticSyntaxValue,
    pub source: SourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<SourceSnippet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticCalleeRecord {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_specifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StaticSourceMatch {
    Call {
        variable_name: String,
        local_name: String,
        exported: bool,
        callee: StaticCalleeRecord,
        args: Vec<StaticSyntaxValue>,
        #[serde(skip_serializing_if = "Option::is_none")]
        object_arg: Option<StaticSyntaxValue>,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        local_initializers: Vec<StaticInitializerRecord>,
    },
    New {
        variable_name: String,
        local_name: String,
        exported: bool,
        callee: StaticCalleeRecord,
        args: Vec<StaticSyntaxValue>,
        #[serde(skip_serializing_if = "Option::is_none")]
        object_arg: Option<StaticSyntaxValue>,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        local_initializers: Vec<StaticInitializerRecord>,
    },
    Object {
        variable_name: String,
        local_name: String,
        exported: bool,
        object: StaticSyntaxValue,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        local_initializers: Vec<StaticInitializerRecord>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StaticSyntaxValue {
    Literal {
        value: LiteralValue,
    },
    Identifier {
        name: String,
    },
    PropertyAccess {
        name: String,
        path: Vec<String>,
    },
    Object {
        properties: Vec<StaticObjectProperty>,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
    },
    Array {
        elements: Vec<StaticSyntaxValue>,
    },
    Call {
        callee: StaticCalleeRecord,
        #[serde(skip_serializing_if = "Option::is_none")]
        receiver: Option<Box<StaticSyntaxValue>>,
        args: Vec<StaticSyntaxValue>,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
    },
    Template {
        text: String,
        expressions: Vec<StaticSyntaxValue>,
    },
    Function {
        calls: Vec<StaticFunctionCallValue>,
        returns: Vec<StaticSyntaxValue>,
        local_initializers: Vec<StaticInitializerRecord>,
        source: SourceLocation,
        #[serde(skip_serializing_if = "Option::is_none")]
        snippet: Option<SourceSnippet>,
    },
    Unsupported {
        syntax_kind: String,
        source: SourceLocation,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum LiteralValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Null,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticObjectProperty {
    pub name: String,
    pub value: StaticSyntaxValue,
    pub shorthand: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spread: Option<bool>,
    pub source: SourceLocation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticFunctionCallValue {
    pub callee: StaticCalleeRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver: Option<Box<StaticSyntaxValue>>,
    pub args: Vec<StaticSyntaxValue>,
    pub source: SourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<SourceSnippet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub file: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnippet {
    pub source: String,
    pub language: String,
    pub range: SourceRange,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub file: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDiagnostic {
    pub id: String,
    pub severity: String,
    pub code: String,
    pub message: String,
    pub source: SourceLocation,
}
