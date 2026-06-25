package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindex/cache"

type Cache = cache.Cache
type FactStore = cache.FactStore
type SQLiteIndexFactStore = cache.SQLiteIndexFactStore

var NewCache = cache.NewCache
var NewSQLiteIndexFactStore = cache.NewSQLiteIndexFactStore
var HasPatchFacts = cache.HasPatchFacts
