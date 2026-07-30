package observability

import (
	"context"
	"fmt"
)

const (
	approvalOccurrenceBaseIdentityKind = "approval-occurrence-base"
	approvalOccurrenceSlotIdentityKind = "approval-occurrence-slot"
)

func validateApprovalArtifactPrivacyAdmission(
	ctx context.Context,
	statements *ingestStatements,
	artifact ArtifactRecord,
) error {
	attributes, err := decodeApprovalArtifactAttributes(artifact.Attributes)
	if err != nil {
		return err
	}
	baseDigest, err := approvalOccurrenceBaseDigest(
		attributes.ApprovalOccurrence,
	)
	if err != nil {
		return err
	}
	for _, identity := range []evidencePrivateIdentity{
		{kind: approvalOccurrenceBaseIdentityKind, id: baseDigest},
		approvalOccurrenceSlotIdentity(artifact.ArtifactID),
	} {
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

// approvalOccurrenceSlotIdentity identifies a private resurrection guard.
// Its tombstone does not prove that a user requested privacy deletion.
func approvalOccurrenceSlotIdentity(
	artifactID string,
) evidencePrivateIdentity {
	return evidencePrivateIdentity{
		kind: approvalOccurrenceSlotIdentityKind,
		id:   artifactID,
	}
}

func approvalOccurrenceBaseDigest(
	occurrence approvalArtifactOccurrence,
) (string, error) {
	canonical, err := canonicalEvidenceJSON(struct {
		Domain        string                    `json:"domain"`
		IdentityEpoch int                       `json:"identityEpoch"`
		Namespace     approvalArtifactNamespace `json:"namespace"`
		ApprovalID    string                    `json:"approvalId"`
	}{
		Domain:        occurrence.Domain,
		IdentityEpoch: occurrence.IdentityEpoch,
		Namespace:     occurrence.Namespace,
		ApprovalID:    occurrence.ApprovalID,
	})
	if err != nil {
		return "", fmt.Errorf("canonical approval occurrence base: %w", err)
	}
	return evidencePrivateIdentityDigest(
		"crux.tool.approval:base:v1\x00" + string(canonical),
	), nil
}

func hasEvidencePrivacyTombstone(
	ctx context.Context,
	statements *ingestStatements,
	identity evidencePrivateIdentity,
) (bool, error) {
	var deleted int
	if err := statements.queryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM evidence_deletion_tombstones
			WHERE authorization_namespace = ?
			  AND identity_kind = ?
			  AND digest_version = ?
			  AND identity_digest = ?
		)
	`, localEvidenceAuthorizationNamespace, identity.kind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(identity.id)).Scan(&deleted); err != nil {
		return false, fmt.Errorf("check evidence privacy tombstone: %w", err)
	}
	return deleted != 0, nil
}
