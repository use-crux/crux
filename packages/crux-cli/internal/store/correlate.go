package store

// correlate is retained as a no-op for catalog/event buffer writes that still
// accept trace ids. Execution timeline correlation is owned by observability.
func (s *Store) correlate(traceID string, eventType string, timestamp int64, data map[string]any) {}
