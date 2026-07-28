package observability

import (
	"context"
	"encoding/json"
)

// loadRedactionProjection reads only privacy evidence and semantic ownership
// coordinates needed by Run Detail, avoiding full record payload hydration.
func (s *Service) loadRedactionProjection(
	ctx context.Context,
	runID string,
) (redactionProjectionEvidence, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			type,
			ifnull(json_extract(payload_json, '$.spanId'), ''),
			ifnull(json_extract(payload_json, '$.artifactId'), ''),
			ifnull(json_extract(payload_json, '$.edgeId'), ''),
			ifnull(json_extract(payload_json, '$.from.kind'), ''),
			ifnull(json_extract(payload_json, '$.from.id'), ''),
			json_extract(payload_json, '$.privacy.redaction')
		FROM records
		WHERE run_id = ?
		  AND json_extract(payload_json, '$.privacy.redaction.applied') = 1
	`, runID)
	if err != nil {
		return redactionProjectionEvidence{}, err
	}
	defer rows.Close()

	projected := newRedactionProjectionEvidence()
	for rows.Next() {
		var (
			recordType    RecordType
			coordinates   redactionRecordCoordinates
			redactionJSON string
		)
		if err := rows.Scan(
			&recordType,
			&coordinates.SpanID,
			&coordinates.ArtifactID,
			&coordinates.EdgeID,
			&coordinates.From.Kind,
			&coordinates.From.ID,
			&redactionJSON,
		); err != nil {
			return redactionProjectionEvidence{}, err
		}

		var redaction ObservabilityRedactionEvidence
		if err := json.Unmarshal([]byte(redactionJSON), &redaction); err != nil {
			continue
		}
		if !redaction.Applied || len(redaction.Surfaces) == 0 {
			continue
		}
		addRedactionProjectionEvidence(
			&projected,
			recordType,
			coordinates,
			&redaction,
		)
	}
	if err := rows.Err(); err != nil {
		return redactionProjectionEvidence{}, err
	}
	return projected, nil
}
