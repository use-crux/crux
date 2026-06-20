package devtools

import (
	"encoding/json"
	"fmt"
)

type projectIndexSourceProfileBatchEvent struct {
	ProtocolVersion int                         `json:"protocolVersion"`
	Type            string                      `json:"type"`
	TransactionID   string                      `json:"transactionId"`
	Sequence        int                         `json:"sequence"`
	Files           []SemanticSourceProfileFile `json:"files"`
}

func (c *ProjectIndexPatchStreamCollector) handleSourceProfileBatch(raw json.RawMessage) error {
	var event projectIndexSourceProfileBatchEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode sourceProfile:batch: %w", err)
	}
	tx, err := c.openTransaction(event.TransactionID)
	if err != nil {
		return err
	}
	if event.Sequence != tx.nextSourceProfileSequence {
		return fmt.Errorf("project index worker transaction %s source profile sequence = %d, want %d", event.TransactionID, event.Sequence, tx.nextSourceProfileSequence)
	}
	tx.sourceProfileFiles = append(tx.sourceProfileFiles, event.Files...)
	tx.nextSourceProfileSequence++
	return nil
}

func semanticSourceProfileFromStreamFiles(files []SemanticSourceProfileFile) *SemanticSourceProfile {
	profileFiles := append([]SemanticSourceProfileFile(nil), files...)
	sourceBytes := 0
	closure := make([]string, 0, len(profileFiles))
	for _, file := range profileFiles {
		sourceBytes += file.SourceBytes
		if file.File != "" {
			closure = append(closure, file.File)
		}
	}
	return &SemanticSourceProfile{
		Files:             profileFiles,
		DependencyClosure: sortedUniqueStrings(closure),
		SourceBytes:       sourceBytes,
		Complete:          true,
	}
}
