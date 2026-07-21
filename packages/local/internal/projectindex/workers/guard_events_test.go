package workers

import "encoding/json"

func staticIndexGuardEvents(root string) ([]json.RawMessage, error) {
	tx := "tx-static-index-extension-host"
	values := []any{
		map[string]any{
			"protocolVersion": 3,
			"type":            "phase:start",
			"transactionId":   tx,
			"phase":           "ast",
			"root":            root,
			"startedAt":       "1970-01-01T00:00:00.000Z",
		},
		map[string]any{
			"protocolVersion": 3,
			"type":            "fact:batch",
			"transactionId":   tx,
			"sequence":        0,
			"facts": []any{
				map[string]any{
					"schemaVersion": 1,
					"factId":        "definitions:prompt:extension-host",
					"kind":          "definitions",
					"phase":         "ast",
					"projectRoot":   root,
					"producer":      map[string]any{"name": workerProducer, "version": "test"},
					"fidelity":      "authoritative",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "test.extensionHost"},
					"fact": map[string]any{
						"id":       "prompt:extension-host",
						"kind":     "prompt",
						"name":     "extension-host",
						"fidelity": "resolved",
						"status":   "active",
					},
				},
			},
		},
		map[string]any{
			"protocolVersion": 3,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           "ast",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "ast",
				"project":       map[string]any{"root": root, "name": "static-index-guard"},
				"startedAt":     "1970-01-01T00:00:00.000Z",
				"finishedAt":    "1970-01-01T00:00:00.000Z",
				"status":        "ok",
				"invalidates":   map[string]any{"all": true},
			},
			"summary": map[string]any{
				"factCount": 1,
				"decision":  map[string]any{"staticIndexComplete": true},
			},
		},
	}
	events := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		events = append(events, data)
	}
	return events, nil
}
