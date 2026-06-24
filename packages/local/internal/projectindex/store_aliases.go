package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindexstore"

type Cache = projectindexstore.Cache
type FactStore = projectindexstore.FactStore
type SQLiteIndexFactStore = projectindexstore.SQLiteIndexFactStore

var NewCache = projectindexstore.NewCache
var NewSQLiteIndexFactStore = projectindexstore.NewSQLiteIndexFactStore
var HasPatchFacts = projectindexstore.HasPatchFacts
