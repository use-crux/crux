package observability

import (
	"context"
	"fmt"
)

const approvalArtifactPrivacySelectorDigestVersion = 1

const (
	approvalSelectorBaseOccurrence    = "base-occurrence"
	approvalSelectorBaseOperation     = "base-operation"
	approvalSelectorBaseRun           = "base-run"
	approvalSelectorProducerOperation = "producer-operation"
	approvalSelectorProducerRun       = "producer-run"
	approvalSelectorProducerSpan      = "producer-span"
)

type approvalArtifactPrivacySelector struct {
	kind   string
	digest string
}

func approvalArtifactPrivacySelectors(
	record Record,
	artifact ArtifactRecord,
) ([]approvalArtifactPrivacySelector, error) {
	attributes, err := decodeApprovalArtifactAttributes(artifact.Attributes)
	if err != nil {
		return nil, err
	}
	occurrence := attributes.ApprovalOccurrence
	baseDigest, err := approvalOccurrenceBaseDigest(occurrence)
	if err != nil {
		return nil, err
	}
	selectors := []approvalArtifactPrivacySelector{
		{kind: approvalSelectorBaseOccurrence, digest: baseDigest},
		{
			kind: approvalSelectorBaseOperation,
			digest: approvalArtifactSelectorDigest(
				approvalSelectorBaseOperation,
				occurrence.Namespace.OperationID,
			),
		},
		{
			kind: approvalSelectorBaseRun,
			digest: approvalArtifactSelectorDigest(
				approvalSelectorBaseRun,
				occurrence.Namespace.RunID,
			),
		},
		{
			kind: approvalSelectorProducerOperation,
			digest: approvalArtifactSelectorDigest(
				approvalSelectorProducerOperation,
				record.OperationID,
			),
		},
		{
			kind: approvalSelectorProducerRun,
			digest: approvalArtifactSelectorDigest(
				approvalSelectorProducerRun,
				record.RunID,
			),
		},
	}
	if artifact.SpanID != "" {
		selectors = append(selectors, approvalArtifactPrivacySelector{
			kind: approvalSelectorProducerSpan,
			digest: approvalArtifactSelectorDigest(
				approvalSelectorProducerSpan,
				artifact.SpanID,
			),
		})
	}
	return selectors, nil
}

func approvalArtifactSelectorDigest(kind string, identity string) string {
	return evidencePrivateIdentityDigest(
		"crux.tool.approval:selector:" + kind + ":v1\x00" + identity,
	)
}

func insertApprovalArtifactPrivacySelectors(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
) error {
	selectors, err := approvalArtifactPrivacySelectors(record, artifact)
	if err != nil {
		return err
	}
	return storeApprovalArtifactPrivacySelectors(
		ctx,
		statements.tx,
		artifact.ArtifactID,
		selectors,
	)
}

func storeApprovalArtifactPrivacySelectors(
	ctx context.Context,
	runner sqliteRunner,
	artifactID string,
	selectors []approvalArtifactPrivacySelector,
) error {
	for _, selector := range selectors {
		if _, err := runner.ExecContext(ctx, `
			INSERT INTO approval_artifact_privacy_selectors (
				authorization_namespace, artifact_id, selector_kind,
				digest_version, selector_digest
			) VALUES (?, ?, ?, ?, ?)
		`, localEvidenceAuthorizationNamespace, artifactID,
			selector.kind, approvalArtifactPrivacySelectorDigestVersion,
			selector.digest); err != nil {
			return fmt.Errorf(
				"store approval artifact privacy selector: %w",
				err,
			)
		}
	}
	return nil
}
