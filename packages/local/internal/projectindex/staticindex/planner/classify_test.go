package planner

import "testing"

func TestProjectStaticIndexSignalMatcherKeepsSpacedCallAndConstructorSupport(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	for _, source := range []string{
		"export const writer = prompt ({ id: 'writer' })",
		"export const worker = new Agent ({ name: 'worker' })",
	} {
		if !matcher.HasCruxInterest(source) {
			t.Fatalf("matcher did not detect Crux interest in %q", source)
		}
	}
}

func TestProjectStaticIndexSignalMatcherIncludesRagBetaPrimitives(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	for _, source := range []string{
		"export const docs = knowledgeBase({ id: 'docs', corpus })",
		"export const recipe = retrievalRecipe({ id: 'answer', steps: [retrieve()] })",
		"export const step = rerank({ engine })",
	} {
		if !matcher.HasCruxInterest(source) {
			t.Fatalf("matcher did not detect RAG beta interest in %q", source)
		}
	}
}
