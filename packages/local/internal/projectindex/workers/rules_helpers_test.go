package workers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

func staticIndexRulesIndexerScript() string {
	return `
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method === 'inspectProjectStaticIndexConfig') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-static-index-config',
					artifact: 'projectStaticIndexConfig',
					root: req.root,
					payload: {
						root: req.root,
						configFile: req.root + '/crux.config.ts',
						nativeAstEnabled: true,
						nativeAstFrontend: 'oxc',
						extensions: [{ package: '@acme/rules' }],
						diagnostics: []
					}
				}) + '\n')
				return
			}
			if (req.method === 'loadStaticExtensionHostManifest') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-extension-host',
					artifact: 'staticExtensionHostManifest',
					root: req.root,
					payload: {
						method: 'loadStaticExtensionHostManifest',
						root: req.root,
						nativeCompilerProtocolVersion: req.nativeCompilerProtocolVersion,
						manifest: {
							cacheInputs: [],
							callNames: [],
							staticInterests: {},
							staticHost: {
								typeScriptRuleCount: 1,
								requiresTypeScriptHostForRules: true,
								nativeOnlyEligible: false
							}
						},
						cacheInputs: [],
						diagnostics: [],
						node: { started: true, reasons: ['typescript-rules'] },
						nativeOnlyEligible: false,
						nativeOnlyReasons: ['typescript-rules'],
						ruleDescriptors: [{
							id: '@acme/rules/native-rule',
							source: 'extension',
							extension: { name: '@acme/rules' },
							title: 'Native rule',
							description: 'Native rule',
							severity: 'warning',
							phase: 'index',
							requires: ['definitions'],
							fidelity: 'safe',
							messageIds: []
						}]
					}
				}) + '\n')
				return
			}
			if (req.method === 'checkStaticRules') {
				if (req.nativeLintFinalize !== true) {
					process.stdout.write(JSON.stringify({
						protocolVersion: 2,
						type: 'artifact:error',
						transactionId: 'artifact-rule-check',
						artifact: 'staticRuleCheck',
						error: { message: 'expected nativeLintFinalize=true, got: ' + JSON.stringify(req.nativeLintFinalize) }
					}) + '\n')
					return
				}
				const definition = req.graph?.definitions?.[0]
				if (definition?.id !== 'prompt:native-rule-input') {
					process.stdout.write(JSON.stringify({
						protocolVersion: 2,
						type: 'artifact:error',
						transactionId: 'artifact-rule-check',
						artifact: 'staticRuleCheck',
						error: { message: 'unexpected graph: ' + JSON.stringify(req.graph) }
					}) + '\n')
					return
				}
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:done',
					transactionId: 'artifact-rule-check',
					artifact: 'staticRuleCheck',
					root: req.root,
					payload: {
						method: 'checkStaticRules',
						root: req.root,
						outputs: [],
						diagnostics: [],
						ruleDescriptors: [],
						facts: { lintFindings: [{ id: 'rule:native-rule', ruleId: 'native-rule', severity: 'warning', message: 'native rule', evidence: [] }] }
					}
				}) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({ error: 'unexpected method: ' + req.method }) + '\n')
		})
	`
}

type staticIndexRuleCompiler struct {
	root                   string
	sourceFile             string
	finalizeCalls          int
	finalizeExtensionFacts json.RawMessage
}

func (c *staticIndexRuleCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]protocol.SourceFile(nil), request.Files...),
			CacheMisses: append([]protocol.SourceFile(nil), request.Files...),
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), 0, len(request.Files), 0),
	}, nil
}

func (c *staticIndexRuleCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("analyze stream flag = false, want true")
	}
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{json.RawMessage(`{"kind":"definition","fact":{"id":"prompt:native-rule-input","kind":"prompt","name":"native-rule-input","fidelity":"resolved","status":"active"}}`)},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), 0, len(request.Files), len(request.Files)),
	}, handle)
}

func (c *staticIndexRuleCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	if c.finalizeCalls == 1 && (request.EmitBuiltinLints == nil || *request.EmitBuiltinLints) {
		return protocol.FinalizeResponse{}, fmt.Errorf("AST finalize emitBuiltinLints = %v, want false", request.EmitBuiltinLints)
	}
	if c.finalizeCalls == 2 && (request.EmitBuiltinLints == nil || !*request.EmitBuiltinLints) {
		return protocol.FinalizeResponse{}, fmt.Errorf("quality finalize emitBuiltinLints = %v, want true", request.EmitBuiltinLints)
	}
	for _, fact := range request.ExtensionFacts {
		c.finalizeExtensionFacts = append(c.finalizeExtensionFacts, fact...)
	}
	phase := "ast"
	if request.PatchPhase != "" {
		phase = request.PatchPhase
	}
	events, err := staticIndexRuleEvents(c.root, phase, c.finalizeCalls == 2)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events:          events,
		Telemetry:       staticIndexTestTelemetry(1, 0, 1, 1),
	}, nil
}

func (c *staticIndexRuleCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *staticIndexRuleCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by Static Index rule scheduling")
}

func (c *staticIndexRuleCompiler) Concurrency() int { return 1 }

func (c *staticIndexRuleCompiler) Close() error { return nil }

var _ syntax.Parser = (*staticIndexRuleCompiler)(nil)
var _ StaticCompiler = (*staticIndexRuleCompiler)(nil)

func staticIndexRuleEvents(root string, phase string, includeRule bool) ([]json.RawMessage, error) {
	facts := []any{
		staticIndexRuleFact(root, phase, "definitions", "definitions:prompt:native-rule-input", map[string]any{"id": "prompt:native-rule-input", "kind": "prompt", "name": "native-rule-input", "fidelity": "resolved", "status": "active"}),
		staticIndexRuleFact(root, phase, "ruleDescriptors", "ruleDescriptors:@acme/rules/native-rule", map[string]any{"id": "@acme/rules/native-rule", "source": "extension", "extension": map[string]any{"name": "@acme/rules"}, "title": "Native rule", "description": "Native rule", "severity": "warning", "requires": []any{"definitions"}}),
	}
	if includeRule {
		facts = append(facts, staticIndexRuleFact(root, phase, "lintFindings", "lintFindings:rule:native-rule", map[string]any{"id": "rule:native-rule", "ruleId": "@acme/rules/native-rule", "severity": "warning", "message": "native rule", "evidence": []any{}}))
	}
	return staticIndexRulePatchEvents(root, phase, facts)
}

func staticIndexRuleFact(root, phase, kind, factID string, fact map[string]any) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"factId":        factID,
		"kind":          kind,
		"phase":         phase,
		"projectRoot":   root,
		"producer":      map[string]any{"name": workerProducer, "version": "test"},
		"fidelity":      "authoritative",
		"provenance":    map[string]any{"kind": "runtime", "attribute": "test.rules"},
		"fact":          fact,
	}
}

func staticIndexRulePatchEvents(root string, phase string, facts []any) ([]json.RawMessage, error) {
	tx := "tx-static-index-rules"
	patch := map[string]any{"schemaVersion": 1, "phase": phase, "project": map[string]any{"root": root, "name": "static-index-rules"}, "startedAt": "1970-01-01T00:00:00.000Z", "finishedAt": "1970-01-01T00:00:00.000Z", "status": "ok"}
	if phase == "ast" {
		patch["invalidates"] = map[string]any{"all": true}
	}
	values := []any{
		map[string]any{"protocolVersion": 2, "type": "phase:start", "transactionId": tx, "phase": phase, "root": root, "startedAt": "1970-01-01T00:00:00.000Z"},
		map[string]any{"protocolVersion": 2, "type": "fact:batch", "transactionId": tx, "sequence": 0, "facts": facts},
		map[string]any{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   tx,
			"phase":           phase,
			"patch":           patch,
			"summary":         map[string]any{"factCount": len(facts), "decision": map[string]any{"staticIndexComplete": true}},
		},
	}
	events := make([]json.RawMessage, 0, len(values))
	for _, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		events = append(events, data)
	}
	return events, nil
}
