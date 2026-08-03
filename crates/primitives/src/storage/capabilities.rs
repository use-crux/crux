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
        "inMemorySearchStore" => StorageFactoryDescriptor {
            kind: "storage.searchStore",
            backend: "inMemorySearchStore",
            capabilities: Some(in_memory_search_capabilities()),
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
                "search": in_memory_search_capabilities()["search"],
            })),
        },
        "convexRecordStore" => StorageFactoryDescriptor {
            kind: "storage.recordStore",
            backend: "convexRecordStore",
            capabilities: Some(
                json!({ "record": { "ttl": "lazy", "filter": "scan", "watch": false, "batch": false } }),
            ),
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
                "record": { "ttl": "lazy", "filter": "scan", "watch": false, "batch": false }
            })),
        },
        "upstashRedisRecordStore" => StorageFactoryDescriptor {
            kind: "storage.recordStore",
            backend: "upstashRedisRecordStore",
            capabilities: Some(
                json!({ "record": { "ttl": "native", "filter": "scan", "watch": "unknown", "batch": false } }),
            ),
        },
        "upstashSearchStore" => StorageFactoryDescriptor {
            kind: "storage.searchStore",
            backend: "upstashSearchStore",
            capabilities: Some(json!({
                "search": {
                    "legs": {
                        "dense": true,
                        "sparse": false,
                        "lexical": false
                    },
                    "fusion": [],
                    "filter": "pre",
                    "consistency": "eventual"
                }
            })),
        },
        "postgresSearchStore" => StorageFactoryDescriptor {
            kind: "storage.searchStore",
            backend: "postgresSearchStore",
            capabilities: Some(json!({
                "search": {
                    "legs": {
                        "dense": true,
                        "sparse": false,
                        "lexical": false
                    },
                    "fusion": [],
                    "filter": "pre",
                    "consistency": "strong"
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

fn in_memory_search_capabilities() -> Value {
    json!({
        "search": {
            "legs": {
                "dense": true,
                "sparse": true,
                "lexical": false
            },
            "fusion": ["rrf"],
            "filter": "pre",
            "consistency": "strong"
        }
    })
}
