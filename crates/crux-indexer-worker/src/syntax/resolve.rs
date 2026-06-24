use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde_json::Value;

#[derive(Clone)]
struct ResolverConfig {
    base_url: PathBuf,
    aliases: Vec<PathAlias>,
}

#[derive(Clone)]
struct PathAlias {
    prefix: String,
    suffix: String,
    has_wildcard: bool,
    targets: Vec<String>,
}

static CONFIG_CACHE: OnceLock<Mutex<HashMap<String, Option<ResolverConfig>>>> = OnceLock::new();

pub fn resolve_static_import_file(
    root: &str,
    importer_file: &str,
    specifier: &str,
) -> Option<String> {
    if specifier.starts_with('.') {
        let importer_dir = Path::new(importer_file).parent()?;
        return resolve_import_base(importer_dir.join(specifier));
    }
    let config = resolver_config_for_root(root)?;
    let alias_base = resolve_alias_base(specifier, &config)?;
    resolve_import_base(alias_base)
}

fn resolver_config_for_root(root: &str) -> Option<ResolverConfig> {
    let cache = CONFIG_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().ok()?;
    if let Some(config) = cache.get(root) {
        return config.clone();
    }
    let loaded = load_resolver_config(root);
    cache.insert(root.to_string(), loaded.clone());
    loaded
}

fn load_resolver_config(root: &str) -> Option<ResolverConfig> {
    let config_file = Path::new(root).join("tsconfig.json");
    let raw = fs::read_to_string(config_file).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    let compiler_options = parsed.get("compilerOptions")?.as_object()?;
    let base_url_value = compiler_options
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or(".");
    let paths = compiler_options.get("paths")?.as_object()?;
    let aliases = paths
        .iter()
        .filter_map(|(pattern, targets)| path_alias(pattern, targets))
        .collect::<Vec<_>>();
    if aliases.is_empty() {
        return None;
    }
    Some(ResolverConfig {
        base_url: Path::new(root).join(base_url_value),
        aliases,
    })
}

fn path_alias(pattern: &str, targets: &Value) -> Option<PathAlias> {
    let targets = targets
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if targets.is_empty() {
        return None;
    }
    let star = pattern.find('*');
    let prefix = star.map_or(pattern, |index| &pattern[..index]).to_string();
    let suffix = star.map_or("", |index| &pattern[index + 1..]).to_string();
    Some(PathAlias {
        prefix,
        suffix,
        has_wildcard: star.is_some(),
        targets,
    })
}

fn resolve_alias_base(specifier: &str, config: &ResolverConfig) -> Option<PathBuf> {
    for alias in &config.aliases {
        if !alias.has_wildcard && specifier != alias.prefix {
            continue;
        }
        if !specifier.starts_with(&alias.prefix) || !specifier.ends_with(&alias.suffix) {
            continue;
        }
        let matched_end = specifier.len().saturating_sub(alias.suffix.len());
        if alias.has_wildcard && alias.prefix.len() > matched_end {
            continue;
        }
        let matched = if alias.has_wildcard {
            &specifier[alias.prefix.len()..matched_end]
        } else {
            ""
        };
        for target in &alias.targets {
            let mapped = if target.contains('*') {
                target.replace('*', matched)
            } else {
                target.clone()
            };
            let absolute = config.base_url.join(mapped);
            if resolve_import_base(absolute.clone()).is_some() {
                return Some(absolute);
            }
        }
    }
    None
}

fn resolve_import_base(base: PathBuf) -> Option<String> {
    let base_string = base.to_string_lossy();
    let candidates = [
        base.clone(),
        PathBuf::from(format!("{base_string}.ts")),
        PathBuf::from(format!("{base_string}.tsx")),
        PathBuf::from(format!("{base_string}.js")),
        PathBuf::from(format!("{base_string}.jsx")),
        PathBuf::from(format!("{base_string}.mjs")),
        PathBuf::from(format!("{base_string}.cjs")),
        base.join("index.ts"),
        base.join("index.tsx"),
        base.join("index.js"),
        base.join("index.jsx"),
        base.join("index.mjs"),
        base.join("index.cjs"),
    ];
    candidates
        .into_iter()
        .find(|candidate| is_importable_file(candidate))
        .map(|path| {
            path.canonicalize()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string()
        })
}

fn is_importable_file(file: &Path) -> bool {
    !file.to_string_lossy().ends_with(".d.ts") && file.is_file()
}
