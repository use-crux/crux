use std::path::{Path, PathBuf};

fn crate_src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

#[test]
fn phase8_rust_runtime_boundaries_use_target_module_names() {
    let src = crate_src();

    for path in [
        "server/mod.rs",
        "server/static_syntax.rs",
        "server/native_static.rs",
        "protocol/worker.rs",
        "protocol/static_syntax.rs",
        "protocol/native_static.rs",
        "native_static/mod.rs",
        "native_static/pipeline.rs",
    ] {
        assert!(
            src.join(path).is_file(),
            "expected Phase 8 Rust boundary file {path}"
        );
    }

    for path in [
        "serve.rs",
        "worker",
        "protocol/static_compile.rs",
        "protocol/static_compiler.rs",
        "protocol/syntax_record.rs",
        "protocol/syntax_worker.rs",
    ] {
        assert!(
            !src.join(path).exists(),
            "old Phase 8 Rust boundary path should be removed: {path}"
        );
    }
}
