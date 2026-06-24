/**
 * Dependency that can invalidate cached extraction or query results.
 *
 * Static parsing derives source dependencies from imports and config boundary files, then layers
 * compiler and extension manifest identities on top. Digest-bearing entries are for data manifests
 * whose behavior can change without changing the package version during local development.
 */
export type IndexDependency =
  | { readonly kind: 'source-file'; readonly file: string }
  | { readonly kind: 'config-file'; readonly file: string }
  | { readonly kind: 'compiler-profile'; readonly name: string; readonly version: string }
  | { readonly kind: 'compiler-projection'; readonly name: string; readonly version: string; readonly phase: string }
  | { readonly kind: 'syntax-frontend'; readonly name: string; readonly version: string }
  | { readonly kind: 'extension'; readonly name: string; readonly version: string }
  | { readonly kind: 'extension-manifest'; readonly name: string; readonly version: string; readonly digest: string }
  | { readonly kind: 'extractor'; readonly extension: string; readonly name: string }
  | { readonly kind: 'rule'; readonly extension: string; readonly name: string }
  | { readonly kind: 'static-evidence-manifest'; readonly name: string; readonly digest: string }
  | { readonly kind: 'relation-policy'; readonly name: string; readonly digest: string }
  | { readonly kind: 'native-primitive-manifest'; readonly name: string; readonly version: string; readonly digest: string }
