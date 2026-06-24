use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::native_static_protocol::{
    NativeStaticAnalyzeFile, NativeStaticMethod, NativeStaticPlan, NativeStaticRunIdentity,
    is_false,
};

/// `nativeStaticCompile` request for native-only AST indexing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticCompileRequest {
    pub protocol_version: u8,
    pub method: NativeStaticMethod,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
    pub identity: NativeStaticRunIdentity,
    pub plan: NativeStaticPlan,
    pub files: Vec<NativeStaticAnalyzeFile>,
    pub native_facts: Vec<Value>,
    pub extension_facts: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation_specs: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lint_config: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emit_builtin_lints: Option<bool>,
}
