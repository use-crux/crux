package screens

import "encoding/json"

// semanticSpanAttributeKeys is the closed set consumed by semantic primitive
// renderers. Unknown attributes remain available through explicit raw inspect
// and export; they never become an accidental generic JSON product surface.
var semanticSpanAttributeKeys = map[string]struct{}{
	"agent": {}, "agents": {}, "args": {}, "compositionId": {},
	"count": {}, "dim": {}, "error": {}, "finishReason": {},
	"flowId": {}, "fromAgent": {}, "fromStepId": {}, "handoffId": {},
	"hits": {}, "hops": {}, "input": {}, "inputSize": {},
	"judgeName": {}, "k": {}, "key": {}, "maxTokens": {},
	"model": {}, "op": {}, "output": {}, "outputSize": {},
	"payload": {}, "provider": {}, "query": {}, "quorum": {},
	"rationale": {}, "reason": {}, "resumeReason": {}, "result": {},
	"retrieverId": {}, "returnValue": {}, "revision": {}, "scope": {},
	"score": {}, "stepId": {}, "stepIds": {}, "stepLabel": {},
	"strategy": {}, "subScores": {}, "summary": {}, "targetId": {},
	"temperature": {}, "to": {}, "toAgent": {}, "tokenSavingsEstimate": {},
	"tokens": {}, "tokensAfter": {}, "tokensBefore": {}, "toolCallId": {},
	"toolCalls": {}, "toolName": {}, "usage": {}, "value": {},
	"votes": {}, "winner": {}, "writer": {},
}

func mergeSemanticSpanAttributes(target map[string]any, raw json.RawMessage) {
	for key, value := range decodeRawObject(raw) {
		if _, supported := semanticSpanAttributeKeys[key]; supported {
			target[key] = value
		}
	}
}
