package observability

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

const evidenceCursorSchemaEpoch = 2

var ErrEvidenceCursorInvalid = errors.New("evidence cursor invalid")

type evidenceCursorV1 struct {
	Version        int    `json:"v"`
	Namespace      string `json:"ns"`
	SubjectKind    string `json:"sk"`
	SubjectID      string `json:"sid"`
	Role           string `json:"role"`
	IncludeHistory bool   `json:"history"`
	IncludeData    bool   `json:"data"`
	SchemaEpoch    int    `json:"epoch"`
	Revision       int64  `json:"revision"`
	ValidUntil     string `json:"validUntil"`
	AcceptedAt     string `json:"acceptedAt"`
	EvidenceID     string `json:"evidenceId"`
}

type evidenceCursorBinding struct {
	subjectKind string
	subjectID   string
	revision    int64
	validUntil  string
	now         time.Time
}

func encodeEvidenceCursor(
	request EvidenceInspectRequest,
	binding evidenceCursorBinding,
	position evidenceRelationshipRow,
) (string, error) {
	raw, err := json.Marshal(evidenceCursorV1{
		Version:        1,
		Namespace:      localEvidenceAuthorizationNamespace,
		SubjectKind:    binding.subjectKind,
		SubjectID:      binding.subjectID,
		Role:           request.Role,
		IncludeHistory: request.IncludeHistory,
		IncludeData:    request.IncludeData,
		SchemaEpoch:    evidenceCursorSchemaEpoch,
		Revision:       binding.revision,
		ValidUntil:     binding.validUntil,
		AcceptedAt:     position.acceptedAt,
		EvidenceID:     position.id,
	})
	if err != nil {
		return "", fmt.Errorf("encode evidence cursor: %w", err)
	}
	cursor := base64.RawURLEncoding.EncodeToString(raw)
	if len(cursor) > 4_096 {
		return "", ErrEvidenceCursorInvalid
	}
	return cursor, nil
}

func decodeEvidenceCursor(
	request EvidenceInspectRequest,
	binding evidenceCursorBinding,
) (*evidenceCursorV1, error) {
	if request.Cursor == "" {
		return nil, nil
	}
	if len(request.Cursor) > 4_096 || request.Role == "" {
		return nil, ErrEvidenceCursorInvalid
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(request.Cursor)
	if err != nil {
		return nil, ErrEvidenceCursorInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cursor evidenceCursorV1
	if err := decoder.Decode(&cursor); err != nil {
		return nil, ErrEvidenceCursorInvalid
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, ErrEvidenceCursorInvalid
	}
	if cursor.Version != 1 ||
		cursor.Namespace != localEvidenceAuthorizationNamespace ||
		cursor.SubjectKind != binding.subjectKind ||
		cursor.SubjectID != binding.subjectID ||
		cursor.Role != request.Role ||
		cursor.IncludeHistory != request.IncludeHistory ||
		cursor.IncludeData != request.IncludeData ||
		cursor.SchemaEpoch != evidenceCursorSchemaEpoch ||
		cursor.Revision != binding.revision ||
		cursor.ValidUntil != binding.validUntil ||
		!isEvidenceCursorTimestamp(cursor.ValidUntil) ||
		!binding.now.Before(mustParseEvidenceCursorTime(cursor.ValidUntil)) ||
		cursor.AcceptedAt == "" ||
		!isEvidenceCursorTimestamp(cursor.AcceptedAt) ||
		!evidenceIDPattern.MatchString(cursor.EvidenceID) {
		return nil, ErrEvidenceCursorInvalid
	}
	return &cursor, nil
}

func mustParseEvidenceCursorTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, value)
	return parsed
}

func isEvidenceCursorTimestamp(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}
