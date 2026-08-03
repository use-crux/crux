package manifestcontract

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func canonicalManifestJSON(content ManifestContent) ([]byte, error) {
	encoded, err := json.Marshal(content)
	if err != nil {
		return nil, fmt.Errorf("encode deployment manifest content: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("normalize deployment manifest content: %w", err)
	}

	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("canonicalize deployment manifest content: %w", err)
	}
	result := bytes.TrimSuffix(canonical.Bytes(), []byte("\n"))
	result = bytes.ReplaceAll(result, []byte(`\u2028`), []byte("\u2028"))
	result = bytes.ReplaceAll(result, []byte(`\u2029`), []byte("\u2029"))
	return result, nil
}

func validDefinitionKind(value string) bool {
	return oneOf(
		value,
		"prompt", "context", "injectable", "tool", "agent", "embedding", "embedding.call", "evidence.record", "flow", "flow.step", "task", "deferred-work",
		"composition.parallel", "composition.parallel.branch", "composition.pipeline", "composition.pipeline.stage", "composition.swarm", "composition.consensus",
		"routing.router", "routing.router.route", "routing.split", "routing.split.route", "routing.retry", "routing.retry.target", "routing.cascade", "routing.cascade.tier", "routing.fallback", "routing.fallback.option",
		"rag.knowledgeBase", "rag.knowledgeBase.view", "rag.indexer", "rag.recipe", "rag.recipe.step", "rag.pipeline", "rag.pipeline.stage", "rag.reranker", "rag.retriever",
		"knowledge.relation", "knowledge.assertions", "knowledge.communities", "knowledge.model",
		"registry", "skill", "memory", "memory.store", "memory.block", "blackboard", "workspace",
		"storage.recordStore", "storage.searchStore", "storage.assetStore", "storage.bundle", "storage.scope",
		"constraint", "guardrail", "toolPolicy", "scorer", "eval", "eval.case",
		"media.operation", "ingest.source", "unknown",
	)
}
