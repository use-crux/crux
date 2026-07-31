package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// InspectRequest reads one redacted request inspection from retained graph evidence.
func (s *Service) InspectRequest(ctx context.Context, id string) (json.RawMessage, error) {
	if !validRequestInspectionID(id) {
		return nil, fmt.Errorf("request inspection id is invalid")
	}
	var raw []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT preview_json
		FROM artifacts
		WHERE kind = 'request.plan'
		  AND json_extract(attributes_json, '$.requestId') = ?
		  AND preview_json IS NOT NULL
		ORDER BY created_at DESC, artifact_id DESC
		LIMIT 1
	`, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read request inspection: %w", err)
	}
	var retained struct {
		Kind       string          `json:"kind"`
		Receipt    json.RawMessage `json:"receipt"`
		Inspection json.RawMessage `json:"inspection"`
	}
	if err := json.Unmarshal(raw, &retained); err != nil || retained.Kind != "request.plan" {
		return nil, fmt.Errorf("retained request inspection is invalid")
	}
	var receipt struct {
		ID string `json:"id"`
	}
	var inspection struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(retained.Receipt, &receipt) != nil ||
		json.Unmarshal(retained.Inspection, &inspection) != nil ||
		receipt.ID != id || inspection.ID != id {
		return nil, fmt.Errorf("retained request inspection identity is invalid")
	}
	return append(json.RawMessage(nil), retained.Inspection...), nil
}

func validRequestInspectionID(id string) bool {
	if len(id) < len("request_")+1 || len(id) > 512 || !strings.HasPrefix(id, "request_") {
		return false
	}
	for _, char := range id {
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}
