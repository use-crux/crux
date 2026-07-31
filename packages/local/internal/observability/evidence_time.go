package observability

import "time"

const evidenceAcceptanceTimestampLayout = "2006-01-02T15:04:05.000000000Z"

// formatEvidenceAcceptanceTime preserves lexical and chronological order for
// durable Local-owned relationship clocks.
func formatEvidenceAcceptanceTime(value time.Time) string {
	return value.UTC().Format(evidenceAcceptanceTimestampLayout)
}
