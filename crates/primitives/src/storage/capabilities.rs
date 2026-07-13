use serde_json::{Value, json};

pub(crate) struct StorageFactoryDescriptor {
    pub kind: &'static str,
    pub backend: &'static str,
    pub capabilities: Option<Value>,
}

pub(crate) fn storage_factory_descriptor(name: &str) -> Option<StorageFactoryDescriptor> {
    let descriptor = match name {
        "inMemoryRecordStore" => StorageFactoryDescriptor {
            kind: "storage.recordStore",
            backend: "inMemoryRecordStore",
            capabilities: Some(in_memory_record_capabilities()),
        },
        "inMemoryVectorStore" => StorageFactoryDescriptor {
            kind: "storage.vectorStore",
            backend: "inMemoryVectorStore",
            capabilities: Some(in_memory_vector_capabilities()),
        },
        "inMemoryAssetStore" => StorageFactoryDescriptor {
            kind: "storage.assetStore",
            backend: "inMemoryAssetStore",
            capabilities: None,
        },
        "inMemoryStorage" => StorageFactoryDescriptor {
            kind: "storage.bundle",
            backend: "inMemoryStorage",
            capabilities: Some(json!({
                "record": in_memory_record_capabilities()["record"],
                "vector": in_memory_vector_capabilities()["vector"],
            })),
        },
        "convexRecordStore" => StorageFactoryDescriptor {
            kind: "storage.recordStore",
            backend: "convexRecordStore",
            capabilities: Some(
                json!({ "record": { "ttl": "lazy", "filter": "scan", "watch": false, "batch": false } }),
            ),
        },
        "convexVectorStore" => StorageFactoryDescriptor {
            kind: "storage.vectorStore",
            backend: "convexVectorStore",
            capabilities: Some(json!({
                "vector": {
                    "dense": true,
                    "sparse": false,
                    "hybrid": false,
                    "fusion": [],
                    "filter": "post",
                    "consistency": "strong"
                }
            })),
        },
        "convexAssetStore" => StorageFactoryDescriptor {
            kind: "storage.assetStore",
            backend: "convexAssetStore",
            capabilities: None,
        },
        "convexStorage" => StorageFactoryDescriptor {
            kind: "storage.bundle",
            backend: "convexStorage",
            capabilities: Some(json!({
                "record": { "ttl": "lazy", "filter": "scan", "watch": false, "batch": false },
                "vector": {
                    "dense": true,
                    "sparse": false,
                    "hybrid": false,
                    "fusion": [],
                    "filter": "post",
                    "consistency": "strong"
                }
            })),
        },
        "upstashRedisRecordStore" => StorageFactoryDescriptor {
            kind: "storage.recordStore",
            backend: "upstashRedisRecordStore",
            capabilities: Some(
                json!({ "record": { "ttl": "native", "filter": "scan", "watch": "unknown", "batch": false } }),
            ),
        },
        "upstashVectorStore" => StorageFactoryDescriptor {
            kind: "storage.vectorStore",
            backend: "upstashVectorStore",
            capabilities: Some(json!({
                "vector": {
                    "dense": true,
                    "sparse": false,
                    "hybrid": false,
                    "fusion": [],
                    "filter": "pre",
                    "consistency": "eventual"
                }
            })),
        },
        _ => return None,
    };
    Some(descriptor)
}

fn in_memory_record_capabilities() -> Value {
    json!({ "record": { "ttl": "lazy", "filter": "scan", "watch": true, "batch": false } })
}

fn in_memory_vector_capabilities() -> Value {
    json!({
        "vector": {
            "dense": true,
            "sparse": true,
            "hybrid": true,
            "fusion": [],
            "filter": "pre",
            "consistency": "strong"
        }
    })
}
