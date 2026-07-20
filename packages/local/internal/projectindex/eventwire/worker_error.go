package eventwire

import "github.com/use-crux/crux/packages/local/internal/runtimeartifact"

// WorkerEventError preserves the typed failure fields carried by the V2
// Project Index worker protocol.
type WorkerEventError = runtimeartifact.WorkerError

// RuntimeArtifactFinding is one strictly decoded child of an aggregate
// Runtime artifact generation failure.
type RuntimeArtifactFinding = runtimeartifact.Finding
