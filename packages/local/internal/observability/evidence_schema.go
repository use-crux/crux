package observability

const approvalArtifactOccurrenceSchema = `CREATE TABLE IF NOT EXISTS approval_artifact_occurrences (
	authorization_namespace TEXT NOT NULL,
	artifact_id TEXT NOT NULL,
	identity_version INTEGER NOT NULL,
	semantic_digest_version INTEGER NOT NULL,
	state TEXT NOT NULL CHECK (state IN ('active', 'retained-out')),
	semantic_digest TEXT,
	artifact_record_id TEXT,
	accepted_at TEXT,
	PRIMARY KEY (authorization_namespace, artifact_id),
	CHECK (
		(state = 'active' AND semantic_digest IS NOT NULL
			AND artifact_record_id IS NOT NULL AND accepted_at IS NOT NULL)
		OR
		(state = 'retained-out' AND semantic_digest IS NULL
			AND artifact_record_id IS NULL AND accepted_at IS NULL)
	)
) WITHOUT ROWID`

const approvalArtifactPrivacySelectorSchema = `CREATE TABLE IF NOT EXISTS approval_artifact_privacy_selectors (
	authorization_namespace TEXT NOT NULL,
	artifact_id TEXT NOT NULL,
	selector_kind TEXT NOT NULL CHECK (
		selector_kind IN (
			'base-occurrence', 'base-operation', 'base-run',
			'producer-operation', 'producer-run', 'producer-span'
		)
	),
	digest_version INTEGER NOT NULL,
	selector_digest TEXT NOT NULL,
	PRIMARY KEY (
		authorization_namespace, artifact_id, selector_kind
	)
) WITHOUT ROWID`

// evidenceSchemaStatements owns graph-invisible, project-local evidence state.
// Every durable identity includes the trusted authorization namespace supplied
// by Local; no record payload can select it.
func evidenceSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS evidence_reservations (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			evidence_kind TEXT NOT NULL,
			source_mode TEXT,
			source_kind TEXT NOT NULL,
			source_id TEXT NOT NULL,
			content_digest_version INTEGER,
			content_digest TEXT,
			idempotency_key_hash TEXT,
			digest_verification_state TEXT NOT NULL CHECK (
				digest_verification_state IN (
					'not-required', 'pending', 'verified'
				)
			),
			canonical_record_digest_version INTEGER NOT NULL,
			canonical_record_digest TEXT NOT NULL,
			edge_id TEXT NOT NULL,
			edge_record_id TEXT NOT NULL,
			relationship_accepted_at TEXT NOT NULL,
			PRIMARY KEY (authorization_namespace, evidence_id)
		) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS evidence_relationships (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			evidence_kind TEXT NOT NULL,
			conclusion TEXT,
			observed_at TEXT,
			recorded_at TEXT NOT NULL,
			source_mode TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_id TEXT NOT NULL,
			producer_kind TEXT NOT NULL,
			producer_id TEXT NOT NULL,
			original_capture_state TEXT,
			payload_state TEXT NOT NULL,
			payload_json TEXT,
			payload_unavailable_reason TEXT,
			payload_accepted_at TEXT,
			payload_expired_at TEXT,
			accepted_after_terminal_kind TEXT,
			accepted_after_terminal_id TEXT,
			run_id TEXT NOT NULL,
			edge_id TEXT NOT NULL,
			edge_record_id TEXT NOT NULL,
			relationship_accepted_at TEXT NOT NULL,
			superseded INTEGER NOT NULL DEFAULT 0
				CHECK (superseded IN (0, 1)),
			PRIMARY KEY (authorization_namespace, evidence_id),
			FOREIGN KEY (authorization_namespace, evidence_id)
				REFERENCES evidence_reservations (
					authorization_namespace, evidence_id
				) ON DELETE CASCADE
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_relationships_subject_role
			ON evidence_relationships (
				authorization_namespace, subject_kind, subject_id, role,
				relationship_accepted_at DESC, evidence_id DESC
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_relationships_source
			ON evidence_relationships (
				authorization_namespace, source_kind, source_id
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_relationships_producer
			ON evidence_relationships (
				authorization_namespace, producer_kind, producer_id
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_relationships_retention
			ON evidence_relationships (
				authorization_namespace, relationship_accepted_at, evidence_id
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_payload_retention
			ON evidence_relationships (
				authorization_namespace, payload_state, payload_accepted_at,
				evidence_id
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_payload_records (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			record_digest_version INTEGER NOT NULL,
			record_digest TEXT NOT NULL,
			PRIMARY KEY (authorization_namespace, evidence_id),
			FOREIGN KEY (authorization_namespace, evidence_id)
				REFERENCES evidence_relationships (
					authorization_namespace, evidence_id
				) ON DELETE CASCADE
		) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS evidence_supersessions (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			superseded_evidence_id TEXT NOT NULL,
			PRIMARY KEY (
				authorization_namespace, evidence_id, superseded_evidence_id
			),
			FOREIGN KEY (authorization_namespace, evidence_id)
				REFERENCES evidence_relationships (
					authorization_namespace, evidence_id
				) ON DELETE CASCADE
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_supersessions_predecessor
			ON evidence_supersessions (
				authorization_namespace, superseded_evidence_id, evidence_id
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_staging_candidates (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			digest_version INTEGER NOT NULL,
			candidate_digest TEXT NOT NULL,
			artifact_id TEXT NOT NULL,
			record_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			operation_id TEXT NOT NULL,
			trace_id TEXT,
			segment_id TEXT NOT NULL,
			segment_seq INTEGER NOT NULL,
			capture_state TEXT NOT NULL,
			record_payload_json TEXT NOT NULL,
			candidate_bytes INTEGER NOT NULL,
			retained_bytes INTEGER NOT NULL,
			accepted_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			PRIMARY KEY (
				authorization_namespace, evidence_id, digest_version,
				candidate_digest
			),
			UNIQUE (authorization_namespace, record_id)
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_staging_namespace_expiry
			ON evidence_staging_candidates (
				authorization_namespace, expires_at, evidence_id
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_staging_expiry
			ON evidence_staging_candidates (expires_at)`,
		`CREATE TABLE IF NOT EXISTS evidence_coverage_events (
			authorization_namespace TEXT NOT NULL,
			event_id TEXT NOT NULL,
			record_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			producer_span_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			status TEXT NOT NULL,
			accepted_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			PRIMARY KEY (authorization_namespace, event_id)
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_coverage_events_expiry
			ON evidence_coverage_events (expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_coverage_events_retention
			ON evidence_coverage_events (
				authorization_namespace, accepted_at, event_id
			)`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_coverage_events_subject
			ON evidence_coverage_events (
				authorization_namespace, subject_kind, subject_id, role, status
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_coverage_projection (
			authorization_namespace TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			status TEXT NOT NULL,
			support_count INTEGER NOT NULL,
			first_accepted_at TEXT NOT NULL,
			last_accepted_at TEXT NOT NULL,
			PRIMARY KEY (
				authorization_namespace, subject_kind, subject_id, role, status
			)
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_coverage_projection_subject
			ON evidence_coverage_projection (
				authorization_namespace, subject_kind, subject_id, role
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_subject_revisions (
			authorization_namespace TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (
				authorization_namespace, subject_kind, subject_id
			)
		) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS evidence_truncation_watermarks (
			authorization_namespace TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			truncated_at TEXT NOT NULL,
			PRIMARY KEY (
				authorization_namespace, subject_kind, subject_id, role
			)
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_truncation_subject
			ON evidence_truncation_watermarks (
				authorization_namespace, subject_kind, subject_id
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_deletion_tombstones (
			authorization_namespace TEXT NOT NULL,
			identity_kind TEXT NOT NULL,
			digest_version INTEGER NOT NULL,
			identity_digest TEXT NOT NULL,
			deleted_at TEXT NOT NULL,
			PRIMARY KEY (
				authorization_namespace, identity_kind, digest_version,
				identity_digest
			)
		) WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS idx_evidence_deletion_tombstones_digest
			ON evidence_deletion_tombstones (
				authorization_namespace, digest_version, identity_digest
			)`,
		`CREATE TABLE IF NOT EXISTS evidence_ingest_health (
			authorization_namespace TEXT NOT NULL,
			code TEXT NOT NULL,
			occurrence_count INTEGER NOT NULL DEFAULT 1,
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			PRIMARY KEY (authorization_namespace, code)
		) WITHOUT ROWID`,
		approvalArtifactOccurrenceSchema,
		approvalArtifactPrivacySelectorSchema,
		`CREATE INDEX IF NOT EXISTS idx_approval_artifact_privacy_selector_lookup
			ON approval_artifact_privacy_selectors (
				authorization_namespace, selector_kind, digest_version,
				selector_digest, artifact_id
			)`,
	}
}

func evidenceTableNamesForDeletion() []string {
	return []string{
		"evidence_payload_records",
		"evidence_supersessions",
		"evidence_relationships",
		"evidence_reservations",
		"evidence_staging_candidates",
		"evidence_coverage_events",
		"evidence_coverage_projection",
		"evidence_subject_revisions",
		"evidence_truncation_watermarks",
		"evidence_deletion_tombstones",
		"evidence_ingest_health",
		"approval_artifact_privacy_selectors",
		"approval_artifact_occurrences",
	}
}
