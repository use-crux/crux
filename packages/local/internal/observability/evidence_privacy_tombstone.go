package observability

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const (
	evidencePrivacyDeletedCode    = "EVIDENCE_PRIVACY_DELETED"
	evidencePrivacyDeletedMessage = "evidence delivery references deleted " +
		"private state and cannot be accepted"
	evidencePrivacyIdentityDigestVersion = 1
)

type evidencePrivateIdentity struct {
	kind string
	id   string
}

func evidencePrivacyDeleted() error {
	return &evidenceDispositionError{
		code:      evidencePrivacyDeletedCode,
		retryable: false,
	}
}

func evidencePrivateIdentityDigest(id string) string {
	digest := sha256.Sum256([]byte(id))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func validateEvidencePrivacyAdmission(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	identities, qualified, err := evidencePrivateIdentitiesForRecord(record)
	if err != nil || !qualified {
		return err
	}
	for _, identity := range identities {
		deleted, err := hasEvidencePrivacyTombstone(
			ctx,
			statements,
			identity,
		)
		if err != nil {
			return err
		}
		if deleted {
			return evidencePrivacyDeleted()
		}
	}
	return nil
}

func evidencePrivateIdentitiesForRecord(
	record Record,
) ([]evidencePrivateIdentity, bool, error) {
	switch record.Type {
	case RecordEdge:
		var edge EdgeRecord
		if err := json.Unmarshal(record.Payload, &edge); err != nil {
			return nil, false, err
		}
		if edge.EdgeType != "evidence.for" {
			return nil, false, nil
		}
		var attributes evidenceEdgeAttributes
		if err := json.Unmarshal(edge.Attributes, &attributes); err != nil {
			return nil, true, err
		}
		return []evidencePrivateIdentity{
			{kind: "evidence", id: attributes.EvidenceID},
			{kind: edge.To.Kind, id: edge.To.ID},
			{kind: edge.From.Kind, id: edge.From.ID},
			{kind: attributes.Producer.Kind, id: attributes.Producer.ID},
		}, true, nil
	case RecordArtifact:
		artifact, marker, marked, err := parseEvidenceSourceArtifact(record)
		if err != nil || !marked {
			return nil, marked, err
		}
		identities := []evidencePrivateIdentity{
			{kind: "evidence", id: marker.EvidenceID},
			{kind: "artifact", id: artifact.ArtifactID},
			{kind: "run", id: record.RunID},
		}
		if artifact.SpanID != "" {
			identities = append(identities, evidencePrivateIdentity{
				kind: "span",
				id:   artifact.SpanID,
			})
		}
		return identities, true, nil
	case RecordSpanEvent:
		var event SpanEventRecord
		if err := json.Unmarshal(record.Payload, &event); err != nil {
			return nil, false, err
		}
		if event.Name != "evidence.coverage" {
			return nil, false, nil
		}
		var attributes evidenceCoverageEventAttributes
		if err := json.Unmarshal(event.Attributes, &attributes); err != nil {
			return nil, true, err
		}
		return []evidencePrivateIdentity{
			{kind: attributes.Subject.Kind, id: attributes.Subject.ID},
			{kind: "run", id: record.RunID},
			{kind: "span", id: event.SpanID},
		}, true, nil
	default:
		return nil, false, nil
	}
}

func insertEvidencePrivacyTombstone(
	ctx context.Context,
	statements *ingestStatements,
	identity evidencePrivateIdentity,
	deletedAt string,
) error {
	if identity.id == "" {
		return nil
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_deletion_tombstones (
			authorization_namespace, identity_kind, digest_version,
			identity_digest, deleted_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT DO NOTHING
	`, localEvidenceAuthorizationNamespace, identity.kind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(identity.id), deletedAt); err != nil {
		return fmt.Errorf("write evidence privacy tombstone: %w", err)
	}
	return nil
}
