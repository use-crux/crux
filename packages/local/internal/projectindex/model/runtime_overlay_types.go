package model

import (
	"errors"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type RuntimeUpdateOperation string

const (
	RuntimeUpdateReplace RuntimeUpdateOperation = "replace"
	RuntimeUpdateFailure RuntimeUpdateOperation = "failure"
)

// RuntimeUpdateOwner identifies the definition that exclusively owns an
// overlay. Owner identity, rather than phase, is the replacement boundary.
type RuntimeUpdateOwner struct {
	DefinitionID string `json:"definitionId"`
	Kind         string `json:"kind"`
}

// RuntimeUpdateError is a secret-safe failure classification. Raw errors and
// transport details never cross the Project Index runtime-update boundary.
type RuntimeUpdateError struct {
	Phase    string `json:"phase"`
	Category string `json:"category"`
}

// RuntimeOwnerServerIdentity is self-reported by the remote MCP server. It is
// presentation-only and must never be treated as a trusted owner identifier.
type RuntimeOwnerServerIdentity struct {
	Untrusted bool    `json:"untrusted"`
	Name      *string `json:"name,omitempty"`
	Version   *string `json:"version,omitempty"`
}

// RuntimeOwnerFacts carries the closed, secret-safe facts learned while
// materializing one runtime owner.
type RuntimeOwnerFacts struct {
	Kind            string                      `json:"kind"`
	Implementation  string                      `json:"implementation"`
	ProtocolVersion *string                     `json:"protocolVersion,omitempty"`
	Server          *RuntimeOwnerServerIdentity `json:"server,omitempty"`
}

// RuntimeSuccessfulDiscovery records identity from one complete handshake.
// Its timestamp is independent from the overlay's latest-attempt timestamp.
type RuntimeSuccessfulDiscovery struct {
	ObservedAt      string                      `json:"observedAt"`
	Implementation  string                      `json:"implementation"`
	ProtocolVersion *string                     `json:"protocolVersion,omitempty"`
	Server          *RuntimeOwnerServerIdentity `json:"server,omitempty"`
}

// ProjectIndexRuntimeUpdate replaces one owner's complete runtime contribution
// or records a discovery failure without carrying partial facts.
type ProjectIndexRuntimeUpdate struct {
	SchemaVersion int                       `json:"schemaVersion"`
	Operation     RuntimeUpdateOperation    `json:"operation"`
	UpdateID      string                    `json:"updateId"`
	Owner         RuntimeUpdateOwner        `json:"owner"`
	OwnerFacts    *RuntimeOwnerFacts        `json:"ownerFacts,omitempty"`
	ObservedAt    string                    `json:"observedAt"`
	Revision      string                    `json:"revision,omitempty"`
	Definitions   []store.ProjectDefinition `json:"definitions,omitempty"`
	Relations     []store.ProjectRelation   `json:"relations,omitempty"`
	Error         *RuntimeUpdateError       `json:"error,omitempty"`
}

type RuntimeOverlay struct {
	Owner                   RuntimeUpdateOwner          `json:"owner"`
	OwnerFingerprint        string                      `json:"ownerFingerprint,omitempty"`
	ObservedAt              string                      `json:"observedAt"`
	Revision                string                      `json:"revision,omitempty"`
	Error                   *RuntimeUpdateError         `json:"error,omitempty"`
	LastSuccessfulDiscovery *RuntimeSuccessfulDiscovery `json:"lastSuccessfulDiscovery,omitempty"`
	Definitions             []store.ProjectDefinition   `json:"definitions,omitempty"`
	Relations               []store.ProjectRelation     `json:"relations,omitempty"`
	Diagnostics             []store.IndexDiagnostic     `json:"diagnostics,omitempty"`
}

// RuntimeUpdateConflictError reports a globally ambiguous tool definition ID.
type RuntimeUpdateConflictError struct {
	OwnerID            string
	ConflictingOwnerID string
	ToolID             string
}

// RuntimeUpdateValidationError marks a rejected caller contract without
// exposing its potentially sensitive payload through HTTP.
type RuntimeUpdateValidationError struct{ cause error }

func (e *RuntimeUpdateValidationError) Error() string { return "invalid project index runtime update" }
func (e *RuntimeUpdateValidationError) Unwrap() error { return e.cause }

func NewRuntimeUpdateValidationError(cause error) error {
	return &RuntimeUpdateValidationError{cause: cause}
}

func IsRuntimeUpdateValidationError(err error) bool {
	var target *RuntimeUpdateValidationError
	return errors.As(err, &target)
}

// RuntimeUpdatePersistenceError marks a Local durability failure without
// leaking filesystem or database details to a remote devtools producer.
type RuntimeUpdatePersistenceError struct{ cause error }

func (e *RuntimeUpdatePersistenceError) Error() string {
	return "project index runtime update unavailable"
}
func (e *RuntimeUpdatePersistenceError) Unwrap() error { return e.cause }

func NewRuntimeUpdatePersistenceError(cause error) error {
	return &RuntimeUpdatePersistenceError{cause: cause}
}

func IsRuntimeUpdatePersistenceError(err error) bool {
	var target *RuntimeUpdatePersistenceError
	return errors.As(err, &target)
}

func (e *RuntimeUpdateConflictError) Error() string {
	return fmt.Sprintf(
		"runtime owner %q conflicts with %q at tool %q; configure an MCP prefix",
		e.OwnerID,
		e.ConflictingOwnerID,
		e.ToolID,
	)
}

func IsRuntimeUpdateConflict(err error) bool {
	var conflict *RuntimeUpdateConflictError
	return errors.As(err, &conflict)
}
