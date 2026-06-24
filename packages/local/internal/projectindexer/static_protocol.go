package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

const (
	projectNativeStaticProtocolVersion = 1
	projectNativeStaticPrepareMethod   = "nativeStaticPrepare"
	projectNativeStaticAnalyzeMethod   = "nativeStaticAnalyze"
	projectNativeStaticFinalizeMethod  = "nativeStaticFinalize"
	projectNativeStaticCompileMethod   = "nativeStaticCompile"
)

// StaticCompiler is the Go-owned boundary for the Rust/Oxc static
// compiler lane. It is intentionally separate from syntax-record parsing so
// tests can prove the compiler lane does not call Node projection or
// syntax-record bridges.
type StaticCompiler interface {
	NativeStaticPrepare(context.Context, projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error)
	NativeStaticAnalyzeStream(context.Context, projectNativeStaticAnalyzeRequest, projectNativeStaticAnalyzeStreamHandler) (projectNativeStaticAnalyzeResponse, error)
	NativeStaticFinalize(context.Context, projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error)
	NativeStaticFinalizeStream(context.Context, projectNativeStaticFinalizeRequest, projectNativeStaticFinalizeStreamHandler) (projectNativeStaticFinalizeResponse, error)
}

type projectNativeStaticVersionIdentity struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type projectNativeStaticDigestIdentity struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Digest  string `json:"digest,omitempty"`
}

type projectNativeStaticRunIdentity struct {
	ProtocolVersion      int                                 `json:"protocolVersion"`
	Compiler             projectNativeStaticVersionIdentity  `json:"compiler"`
	Oxc                  projectNativeStaticVersionIdentity  `json:"oxc"`
	PrimitiveManifest    projectNativeStaticDigestIdentity   `json:"primitiveManifest"`
	RelationPolicy       projectNativeStaticDigestIdentity   `json:"relationPolicy"`
	ExtensionManifests   []projectNativeStaticDigestIdentity `json:"extensionManifests"`
	FirstPartyGraphRules projectNativeStaticDigestIdentity   `json:"firstPartyGraphRules"`
	CompilerProjection   projectNativeStaticDigestIdentity   `json:"compilerProjection"`
}

type projectNativeStaticTelemetry struct {
	Node       projectNativeStaticNodeTelemetry       `json:"node"`
	NativeOnly projectNativeStaticNativeOnlyTelemetry `json:"nativeOnly"`
	Timings    []projectNativeStaticTiming            `json:"timings"`
	Files      projectNativeStaticFileTelemetry       `json:"files"`
	Cache      projectNativeStaticCacheTelemetry      `json:"cache"`
	Facts      projectNativeStaticFactTelemetry       `json:"facts"`
}

type projectNativeStaticNodeTelemetry struct {
	Started bool     `json:"started"`
	Reasons []string `json:"reasons"`
}

type projectNativeStaticNativeOnlyTelemetry struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons"`
}

type projectNativeStaticTiming struct {
	Name       string  `json:"name"`
	DurationMs float64 `json:"durationMs"`
	Count      *int    `json:"count,omitempty"`
}

type projectNativeStaticFileTelemetry struct {
	Selected    int `json:"selected"`
	CacheHits   int `json:"cacheHits"`
	CacheMisses int `json:"cacheMisses"`
	Analyzed    int `json:"analyzed"`
	Skipped     int `json:"skipped"`
}

type projectNativeStaticCacheTelemetry struct {
	ReadHits    int `json:"readHits"`
	ReadMisses  int `json:"readMisses"`
	Writes      int `json:"writes"`
	WriteErrors int `json:"writeErrors"`
}

type projectNativeStaticFactTelemetry struct {
	Definitions     int `json:"definitions"`
	Relations       int `json:"relations"`
	SourceRefs      int `json:"sourceRefs"`
	Diagnostics     int `json:"diagnostics"`
	LintFindings    int `json:"lintFindings"`
	RuleDescriptors int `json:"ruleDescriptors"`
	Sources         int `json:"sources"`
	SourceGraph     int `json:"sourceGraph"`
}

type projectNativeStaticSourceFile struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
	CacheKey   string `json:"cacheKey,omitempty"`
}

type projectNativeStaticPlan struct {
	Root                     string                             `json:"root"`
	ProjectName              string                             `json:"projectName,omitempty"`
	Files                    []projectNativeStaticSourceFile    `json:"files"`
	PrimaryFiles             []projectNativeStaticSourceFile    `json:"primaryFiles,omitempty"`
	CacheHits                []projectNativeStaticSourceFile    `json:"cacheHits"`
	CacheMisses              []projectNativeStaticSourceFile    `json:"cacheMisses"`
	CallNames                []string                           `json:"callNames,omitempty"`
	CallInterests            []projectSyntaxCallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                           `json:"constructorNames,omitempty"`
	ConstructorInterests     []projectSyntaxConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                           `json:"pruneNativeFactCallNames,omitempty"`
}

type projectNativeStaticAnalyzeFile struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
	SourceText string `json:"sourceText,omitempty"`
}

type projectNativeStaticPrepareRequest struct {
	ID                       uint64                             `json:"id,omitempty"`
	ProtocolVersion          int                                `json:"protocolVersion"`
	Method                   string                             `json:"method"`
	Root                     string                             `json:"root"`
	ProjectName              string                             `json:"projectName,omitempty"`
	ConfigPath               string                             `json:"configPath,omitempty"`
	Identity                 projectNativeStaticRunIdentity     `json:"identity"`
	Files                    []projectNativeStaticSourceFile    `json:"files"`
	PrimaryFiles             []projectNativeStaticSourceFile    `json:"primaryFiles,omitempty"`
	CallNames                []string                           `json:"callNames,omitempty"`
	CallInterests            []projectSyntaxCallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                           `json:"constructorNames,omitempty"`
	ConstructorInterests     []projectSyntaxConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                           `json:"pruneNativeFactCallNames,omitempty"`
	CacheInputs              []json.RawMessage                  `json:"cacheInputs,omitempty"`
	ExtensionHost            json.RawMessage                    `json:"extensionHost,omitempty"`
}

type projectNativeStaticPrepareResponse struct {
	ProtocolVersion int                          `json:"protocolVersion"`
	Method          string                       `json:"method"`
	Plan            projectNativeStaticPlan      `json:"plan"`
	Diagnostics     []json.RawMessage            `json:"diagnostics"`
	Telemetry       projectNativeStaticTelemetry `json:"telemetry"`
}

type projectNativeStaticAnalyzeRequest struct {
	ID                         uint64                           `json:"id,omitempty"`
	ProtocolVersion            int                              `json:"protocolVersion"`
	Method                     string                           `json:"method"`
	Stream                     bool                             `json:"stream,omitempty"`
	Identity                   projectNativeStaticRunIdentity   `json:"identity"`
	Plan                       projectNativeStaticPlan          `json:"plan"`
	Files                      []projectNativeStaticAnalyzeFile `json:"files"`
	ExtensionEvidenceInterests json.RawMessage                  `json:"extensionEvidenceInterests,omitempty"`
}

type projectNativeStaticAnalyzeResponse struct {
	ProtocolVersion       int                          `json:"protocolVersion"`
	Method                string                       `json:"method"`
	Facts                 []json.RawMessage            `json:"facts"`
	Diagnostics           []json.RawMessage            `json:"diagnostics"`
	ExtensionEvidenceJobs []json.RawMessage            `json:"extensionEvidenceJobs"`
	Telemetry             projectNativeStaticTelemetry `json:"telemetry"`
}

type projectNativeStaticFinalizeRequest struct {
	ID               uint64                         `json:"id,omitempty"`
	ProtocolVersion  int                            `json:"protocolVersion"`
	Method           string                         `json:"method"`
	Stream           bool                           `json:"stream,omitempty"`
	Identity         projectNativeStaticRunIdentity `json:"identity"`
	NativeFacts      []json.RawMessage              `json:"nativeFacts"`
	ExtensionFacts   []json.RawMessage              `json:"extensionFacts"`
	LintFacts        []json.RawMessage              `json:"lintFacts,omitempty"`
	RelationSpecs    json.RawMessage                `json:"relationSpecs,omitempty"`
	RuleResults      json.RawMessage                `json:"ruleResults,omitempty"`
	LintConfig       json.RawMessage                `json:"lintConfig,omitempty"`
	LintFiles        []string                       `json:"lintFiles,omitempty"`
	EmitBuiltinLints *bool                          `json:"emitBuiltinLints,omitempty"`
	PatchPhase       string                         `json:"patchPhase,omitempty"`
	PatchInvalidates json.RawMessage                `json:"patchInvalidates,omitempty"`
	Cache            json.RawMessage                `json:"cache,omitempty"`
}

type projectNativeStaticCompileRequest struct {
	ID               uint64                           `json:"id,omitempty"`
	ProtocolVersion  int                              `json:"protocolVersion"`
	Method           string                           `json:"method"`
	Stream           bool                             `json:"stream,omitempty"`
	Identity         projectNativeStaticRunIdentity   `json:"identity"`
	Plan             projectNativeStaticPlan          `json:"plan"`
	Files            []projectNativeStaticAnalyzeFile `json:"files"`
	NativeFacts      []json.RawMessage                `json:"nativeFacts"`
	ExtensionFacts   []json.RawMessage                `json:"extensionFacts"`
	RelationSpecs    json.RawMessage                  `json:"relationSpecs,omitempty"`
	LintConfig       json.RawMessage                  `json:"lintConfig,omitempty"`
	LintFiles        []string                         `json:"lintFiles,omitempty"`
	EmitBuiltinLints *bool                            `json:"emitBuiltinLints,omitempty"`
}

type projectNativeStaticFinalizeResponse struct {
	ProtocolVersion int                          `json:"protocolVersion"`
	Method          string                       `json:"method"`
	Events          []json.RawMessage            `json:"events"`
	Telemetry       projectNativeStaticTelemetry `json:"telemetry"`
}

type projectNativeStaticWorkerResponse[Resp any] struct {
	ID       uint64 `json:"id"`
	OK       bool   `json:"ok"`
	Response Resp   `json:"response"`
	Error    string `json:"error,omitempty"`
}

func (w *SyntaxWorker) NativeStaticPrepare(ctx context.Context, request projectNativeStaticPrepareRequest) (projectNativeStaticPrepareResponse, error) {
	id := w.nextID.Add(1)
	request.ID = id
	envelope, err := projectNativeStaticCall[projectNativeStaticWorkerResponse[projectNativeStaticPrepareResponse]](ctx, w, request)
	if err != nil {
		return projectNativeStaticPrepareResponse{}, err
	}
	if err := validateProjectNativeStaticWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return projectNativeStaticPrepareResponse{}, err
	}
	response := envelope.Response
	return response, validateProjectNativeStaticResponse(response.ProtocolVersion, response.Method, projectNativeStaticPrepareMethod)
}

func (w *SyntaxWorker) NativeStaticFinalize(ctx context.Context, request projectNativeStaticFinalizeRequest) (projectNativeStaticFinalizeResponse, error) {
	id := w.nextID.Add(1)
	request.ID = id
	envelope, err := projectNativeStaticCall[projectNativeStaticWorkerResponse[projectNativeStaticFinalizeResponse]](ctx, w, request)
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	if err := validateProjectNativeStaticWorkerResponse(envelope.ID, envelope.OK, envelope.Error, id); err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	response := envelope.Response
	return response, validateProjectNativeStaticResponse(response.ProtocolVersion, response.Method, projectNativeStaticFinalizeMethod)
}

func projectNativeStaticCall[Resp any](ctx context.Context, worker *SyntaxWorker, request any) (Resp, error) {
	var zero Resp
	if worker == nil || worker.worker == nil {
		return zero, fmt.Errorf("project native static compiler is not configured")
	}
	return nodeworker.Call[Resp](ctx, worker.worker, request)
}

func validateProjectNativeStaticWorkerResponse(gotID uint64, ok bool, message string, wantID uint64) error {
	if gotID != wantID {
		return fmt.Errorf("native static compiler response id %d, want %d", gotID, wantID)
	}
	if !ok {
		if message == "" {
			return fmt.Errorf("native static compiler failed")
		}
		return fmt.Errorf("native static compiler failed: %s", message)
	}
	return nil
}

func validateProjectNativeStaticResponse(protocolVersion int, method, wantMethod string) error {
	if protocolVersion != projectNativeStaticProtocolVersion {
		return fmt.Errorf("native static compiler protocol version %d, want %d", protocolVersion, projectNativeStaticProtocolVersion)
	}
	if method != wantMethod {
		return fmt.Errorf("native static compiler method %q, want %q", method, wantMethod)
	}
	return nil
}
