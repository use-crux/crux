//! Process-level JSON-lines request/response envelopes for the native worker.
//!
//! These shapes own the transport boundary that Go validates when it talks to
//! the Static Index worker process: the request envelopes the worker accepts and
//! the generic response envelope it writes back. Streaming Project Index event
//! shapes live in [`crate::project_index_events`], and the data they carry lives
//! in [`crate::static_syntax`] / [`crate::static_index`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{StaticSyntaxCallInterest, StaticSyntaxConstructorInterest};

/// Generic JSON-lines response envelope shared by compiler worker methods.
///
/// The envelope is intentionally small: routing and streaming stay in the
/// worker binary, while protocol modules own the serializable wire shape that Go
/// validates at the process boundary.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResponseEnvelope {
    pub id: u64,
    pub ok: bool,
    pub response: Value,
}

impl WorkerResponseEnvelope {
    pub fn ok<T: Serialize>(id: u64, response: T) -> Self {
        Self {
            id,
            ok: true,
            response: serde_json::to_value(response).expect("worker response should serialize"),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum WorkerRequest {
    Batch(BatchWorkerRequest),
    Single(SingleWorkerRequest),
}

impl WorkerRequest {
    pub fn id(&self) -> u64 {
        match self {
            WorkerRequest::Batch(request) => request.id,
            WorkerRequest::Single(request) => request.id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleWorkerRequest {
    pub id: u64,
    pub root: String,
    pub file: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub read_source_from_disk: bool,
    #[serde(default)]
    pub call_names: Vec<String>,
    #[serde(default)]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default)]
    pub constructor_names: Vec<String>,
    #[serde(default)]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default)]
    pub prune_native_fact_call_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchWorkerRequest {
    pub id: u64,
    pub files: Vec<BatchWorkerFileRequest>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub call_names: Vec<String>,
    #[serde(default)]
    pub call_interests: Vec<StaticSyntaxCallInterest>,
    #[serde(default)]
    pub constructor_names: Vec<String>,
    #[serde(default)]
    pub constructor_interests: Vec<StaticSyntaxConstructorInterest>,
    #[serde(default)]
    pub prune_native_fact_call_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchWorkerFileRequest {
    pub root: String,
    pub file: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub read_source_from_disk: bool,
}
