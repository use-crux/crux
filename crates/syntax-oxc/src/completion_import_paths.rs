use std::path::{Component, Path, PathBuf};

pub(crate) fn relative_module_specifier(
    current_file: &str,
    candidate_file: &str,
) -> Option<String> {
    relative_path(
        current_file,
        &without_script_extension(Path::new(candidate_file)),
    )
}

pub(crate) fn relative_source_file(current_file: &str, candidate_file: &str) -> Option<String> {
    relative_path(current_file, Path::new(candidate_file))
}

fn relative_path(current_file: &str, target: &Path) -> Option<String> {
    let current = Path::new(current_file).parent()?;
    let current_components = current.components().collect::<Vec<_>>();
    let target_components = target.components().collect::<Vec<_>>();
    let shared = current_components
        .iter()
        .zip(&target_components)
        .take_while(|(left, right)| left == right)
        .count();
    if shared == 0 && (current.is_absolute() || target.is_absolute()) {
        return None;
    }
    let mut parts = vec![
        "..";
        current_components[shared..]
            .iter()
            .filter(|component| matches!(component, Component::Normal(_)))
            .count()
    ];
    parts.extend(
        target_components[shared..]
            .iter()
            .filter_map(|component| match component {
                Component::Normal(value) => value.to_str(),
                _ => None,
            }),
    );
    let joined = parts.join("/");
    Some(if joined.starts_with('.') {
        joined
    } else {
        format!("./{joined}")
    })
}

fn without_script_extension(path: &Path) -> PathBuf {
    match path.extension().and_then(|value| value.to_str()) {
        Some("ts" | "tsx" | "js" | "jsx" | "mts" | "cts" | "mjs" | "cjs") => {
            path.with_extension("")
        }
        _ => path.to_path_buf(),
    }
}

pub(crate) fn same_module_specifier(actual: &str, expected: &str) -> bool {
    strip_script_extension(actual) == strip_script_extension(expected)
}

fn strip_script_extension(value: &str) -> &str {
    [".tsx", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".ts", ".js"]
        .iter()
        .find_map(|extension| value.strip_suffix(extension))
        .unwrap_or(value)
}

pub(crate) fn same_directory(left: &str, right: &str) -> bool {
    Path::new(left).parent() == Path::new(right).parent()
}

pub(crate) fn safe_binding_name(binding: &str) -> bool {
    if binding == "default" {
        return false;
    }
    let mut characters = binding.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first == '_' || first == '$' || first.is_alphabetic())
        && characters
            .all(|character| character == '_' || character == '$' || character.is_alphanumeric())
}
