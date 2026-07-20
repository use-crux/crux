package projectindex

import "context"

type cachePolicyContextKey struct{}

// WithoutCache marks one indexing operation as cache-free. It is used by
// read-only commands such as setup --check, where even best-effort cache writes
// would violate the command contract.
func WithoutCache(ctx context.Context) context.Context {
	return context.WithValue(ctx, cachePolicyContextKey{}, true)
}

// CacheDisabled reports whether the current indexing operation must avoid
// reading or writing Project Index caches.
func CacheDisabled(ctx context.Context) bool {
	disabled, _ := ctx.Value(cachePolicyContextKey{}).(bool)
	return disabled
}
