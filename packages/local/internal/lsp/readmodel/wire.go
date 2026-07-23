package readmodel

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type wsMessage struct {
	Snapshot *Snapshot
	Delta    *Delta
}

type messageType struct {
	Type string `json:"type"`
}

type snapshotMetadata struct {
	ProjectRoot   string  `json:"projectRoot"`
	ServerVersion string  `json:"serverVersion"`
	Generation    *uint64 `json:"generation"`
}

type deltaMessage struct {
	Generation  *uint64           `json:"generation"`
	File        string            `json:"file"`
	Lints       *LintReplacement  `json:"lints,omitempty"`
	Definitions DefinitionChanges `json:"definitions"`
	SourceRow   json.RawMessage   `json:"sourceRow"`
}

func decodeSnapshot(data []byte) (Snapshot, error) {
	var index api.IndexData
	if err := json.Unmarshal(data, &index); err != nil {
		return Snapshot{}, fmt.Errorf("decode Project Index snapshot: %w", err)
	}
	var metadata snapshotMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return Snapshot{}, fmt.Errorf("decode Project Index metadata: %w", err)
	}
	if metadata.ProjectRoot == "" && index.Project != nil {
		metadata.ProjectRoot = index.Project.Root
	}
	return Snapshot{
		ProjectRoot:   metadata.ProjectRoot,
		ServerVersion: metadata.ServerVersion,
		Generation:    metadata.Generation,
		Findings:      index.LintFindings,
		Definitions:   index.Definitions,
		Relations:     index.Relations,
		Sources:       index.Sources,
	}, nil
}

func decodeWSMessage(data []byte) (wsMessage, bool, error) {
	var envelope messageType
	if err := json.Unmarshal(data, &envelope); err != nil {
		return wsMessage{}, false, fmt.Errorf("decode WebSocket message type: %w", err)
	}
	switch envelope.Type {
	case "index":
		snapshot, err := decodeSnapshot(data)
		if err != nil {
			return wsMessage{}, false, err
		}
		return wsMessage{Snapshot: &snapshot}, true, nil
	case "index:delta":
		var wire deltaMessage
		if err := json.Unmarshal(data, &wire); err != nil {
			return wsMessage{}, false, fmt.Errorf("decode Project Index delta: %w", err)
		}
		if wire.Generation == nil {
			return wsMessage{}, false, fmt.Errorf("decode Project Index delta: generation is required")
		}
		return wsMessage{Delta: &Delta{
			Generation:    *wire.Generation,
			File:          wire.File,
			Lints:         wire.Lints,
			Definitions:   wire.Definitions,
			SourceChanged: wire.SourceRow != nil,
		}}, true, nil
	default:
		return wsMessage{}, false, nil
	}
}
