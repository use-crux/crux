package protocol

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
)

const (
	Version        = 2
	PrepareMethod  = "staticIndexPrepare"
	AnalyzeMethod  = "staticIndexAnalyze"
	FinalizeMethod = "staticIndexFinalize"
	CompileMethod  = "staticIndexCompile"
)

type VersionIdentity struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type DigestIdentity struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Digest  string `json:"digest,omitempty"`
}

type IdentityManifest struct {
	ProtocolVersion    int             `json:"protocolVersion"`
	Compiler           VersionIdentity `json:"compiler"`
	OxcFrontend        VersionIdentity `json:"oxcFrontend"`
	PrimitiveManifest  DigestIdentity  `json:"primitiveManifest"`
	RelationPolicy     DigestIdentity  `json:"relationPolicy"`
	RuleDescriptors    DigestIdentity  `json:"ruleDescriptors"`
	CompilerProjection DigestIdentity  `json:"compilerProjection"`
}

type RunIdentity struct {
	ProtocolVersion    int              `json:"protocolVersion"`
	Compiler           VersionIdentity  `json:"compiler"`
	Oxc                VersionIdentity  `json:"oxc"`
	PrimitiveManifest  DigestIdentity   `json:"primitiveManifest"`
	RelationPolicy     DigestIdentity   `json:"relationPolicy"`
	ExtensionManifests []DigestIdentity `json:"extensionManifests"`
	RuleDescriptors    DigestIdentity   `json:"ruleDescriptors"`
	CompilerProjection DigestIdentity   `json:"compilerProjection"`
}

type Telemetry struct {
	Node       NodeTelemetry       `json:"node"`
	NativeOnly NativeOnlyTelemetry `json:"nativeOnly"`
	Timings    []Timing            `json:"timings"`
	Files      FileTelemetry       `json:"files"`
	Cache      CacheTelemetry      `json:"cache"`
	Facts      FactTelemetry       `json:"facts"`
}

type NodeTelemetry struct {
	Started bool     `json:"started"`
	Reasons []string `json:"reasons"`
}

type NativeOnlyTelemetry struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons"`
}

type Timing struct {
	Name       string  `json:"name"`
	DurationMs float64 `json:"durationMs"`
	Count      *int    `json:"count,omitempty"`
}

type FileTelemetry struct {
	Selected    int `json:"selected"`
	CacheHits   int `json:"cacheHits"`
	CacheMisses int `json:"cacheMisses"`
	Analyzed    int `json:"analyzed"`
	Skipped     int `json:"skipped"`
}

type CacheTelemetry struct {
	ReadHits    int `json:"readHits"`
	ReadMisses  int `json:"readMisses"`
	Writes      int `json:"writes"`
	WriteErrors int `json:"writeErrors"`
}

type FactTelemetry struct {
	Definitions     int `json:"definitions"`
	Relations       int `json:"relations"`
	SourceRefs      int `json:"sourceRefs"`
	Diagnostics     int `json:"diagnostics"`
	LintFindings    int `json:"lintFindings"`
	RuleDescriptors int `json:"ruleDescriptors"`
	Sources         int `json:"sources"`
	SourceGraph     int `json:"sourceGraph"`
}

type SourceFile struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
	CacheKey   string `json:"cacheKey,omitempty"`
}

type Plan struct {
	Root                     string                         `json:"root"`
	ProjectName              string                         `json:"projectName,omitempty"`
	Files                    []SourceFile                   `json:"files"`
	PrimaryFiles             []SourceFile                   `json:"primaryFiles,omitempty"`
	CacheHits                []SourceFile                   `json:"cacheHits"`
	CacheMisses              []SourceFile                   `json:"cacheMisses"`
	CallNames                []string                       `json:"callNames,omitempty"`
	CallInterests            []frontend.CallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                       `json:"constructorNames,omitempty"`
	ConstructorInterests     []frontend.ConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                       `json:"pruneNativeFactCallNames,omitempty"`
}

type AnalyzeFile struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
	SourceText string `json:"sourceText,omitempty"`
}

type LintSuppression struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Scope  string `json:"scope"`
	RuleID string `json:"ruleId"`
}

type PrepareRequest struct {
	ID                       uint64                         `json:"id,omitempty"`
	ProtocolVersion          int                            `json:"protocolVersion"`
	Method                   string                         `json:"method"`
	Root                     string                         `json:"root"`
	ProjectName              string                         `json:"projectName,omitempty"`
	ConfigPath               string                         `json:"configPath,omitempty"`
	Identity                 RunIdentity                    `json:"identity"`
	Files                    []SourceFile                   `json:"files"`
	PrimaryFiles             []SourceFile                   `json:"primaryFiles,omitempty"`
	CallNames                []string                       `json:"callNames,omitempty"`
	CallInterests            []frontend.CallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                       `json:"constructorNames,omitempty"`
	ConstructorInterests     []frontend.ConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                       `json:"pruneNativeFactCallNames,omitempty"`
	CacheInputs              []json.RawMessage              `json:"cacheInputs,omitempty"`
	ExtensionHost            json.RawMessage                `json:"extensionHost,omitempty"`
}

type PrepareResponse struct {
	ProtocolVersion int               `json:"protocolVersion"`
	Method          string            `json:"method"`
	Plan            Plan              `json:"plan"`
	Diagnostics     []json.RawMessage `json:"diagnostics"`
	Telemetry       Telemetry         `json:"telemetry"`
}

type AnalyzeRequest struct {
	ID                         uint64          `json:"id,omitempty"`
	ProtocolVersion            int             `json:"protocolVersion"`
	Method                     string          `json:"method"`
	Stream                     bool            `json:"stream,omitempty"`
	Identity                   RunIdentity     `json:"identity"`
	Plan                       Plan            `json:"plan"`
	Files                      []AnalyzeFile   `json:"files"`
	ExtensionEvidenceInterests json.RawMessage `json:"extensionEvidenceInterests,omitempty"`
}

type AnalyzeResponse struct {
	ProtocolVersion       int               `json:"protocolVersion"`
	Method                string            `json:"method"`
	Facts                 []json.RawMessage `json:"facts"`
	Diagnostics           []json.RawMessage `json:"diagnostics"`
	ExtensionEvidenceJobs []json.RawMessage `json:"extensionEvidenceJobs"`
	Telemetry             Telemetry         `json:"telemetry"`
}

type FinalizeRequest struct {
	ID               uint64            `json:"id,omitempty"`
	ProtocolVersion  int               `json:"protocolVersion"`
	Method           string            `json:"method"`
	Stream           bool              `json:"stream,omitempty"`
	Identity         RunIdentity       `json:"identity"`
	NativeFacts      []json.RawMessage `json:"nativeFacts"`
	ExtensionFacts   []json.RawMessage `json:"extensionFacts"`
	LintFacts        []json.RawMessage `json:"lintFacts,omitempty"`
	RelationSpecs    json.RawMessage   `json:"relationSpecs,omitempty"`
	RuleResults      json.RawMessage   `json:"ruleResults,omitempty"`
	LintConfig       json.RawMessage   `json:"lintConfig,omitempty"`
	LintSuppressions []LintSuppression `json:"lintSuppressions,omitempty"`
	EmitBuiltinLints *bool             `json:"emitBuiltinLints,omitempty"`
	PatchPhase       string            `json:"patchPhase,omitempty"`
	PatchInvalidates json.RawMessage   `json:"patchInvalidates,omitempty"`
	Cache            json.RawMessage   `json:"cache,omitempty"`
}

type CompileRequest struct {
	ID               uint64            `json:"id,omitempty"`
	ProtocolVersion  int               `json:"protocolVersion"`
	Method           string            `json:"method"`
	Stream           bool              `json:"stream,omitempty"`
	Identity         RunIdentity       `json:"identity"`
	Plan             Plan              `json:"plan"`
	Files            []AnalyzeFile     `json:"files"`
	NativeFacts      []json.RawMessage `json:"nativeFacts"`
	ExtensionFacts   []json.RawMessage `json:"extensionFacts"`
	RelationSpecs    json.RawMessage   `json:"relationSpecs,omitempty"`
	LintConfig       json.RawMessage   `json:"lintConfig,omitempty"`
	LintSuppressions []LintSuppression `json:"lintSuppressions,omitempty"`
	EmitBuiltinLints *bool             `json:"emitBuiltinLints,omitempty"`
	PatchInvalidates json.RawMessage   `json:"patchInvalidates,omitempty"`
}

type FinalizeResponse struct {
	ProtocolVersion int               `json:"protocolVersion"`
	Method          string            `json:"method"`
	Events          []json.RawMessage `json:"events"`
	Telemetry       Telemetry         `json:"telemetry"`
}

type WorkerResponse[Resp any] struct {
	ID       uint64 `json:"id"`
	OK       bool   `json:"ok"`
	Response Resp   `json:"response"`
	Error    string `json:"error,omitempty"`
}
