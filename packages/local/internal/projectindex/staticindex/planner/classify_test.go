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
		"export const ranker = reranker({ name: 'answer-ranker', model })",
	} {
		if !matcher.HasCruxInterest(source) {
			t.Fatalf("matcher did not detect RAG beta interest in %q", source)
		}
	}
}

func TestProjectStaticIndexSignalMatcherIncludesConnectedKnowledgePrimitives(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	for _, source := range []string{
		"export const model = knowledgeModel({ name: 'extractor', version: 1, generateText, generateObject })",
		"export const relations = relate({ id: 'relations', version: 1, types: { cites: spec }, run })",
		"export const references = relateReferences()",
		"export const entities = relateEntities({ model })",
		"export const claims = assertions({ id: 'claims', version: 1, types, run })",
		"export const groups = communities({ model })",
		"export const published = docs.view({ id: 'published', where: { status: 'published' } })",
	} {
		if !matcher.HasCruxInterest(source) {
			t.Fatalf("matcher did not detect Connected Knowledge interest in %q", source)
		}
	}
}

func TestProjectStaticIndexSignalMatcherIncludesSafetyToolPolicy(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	if !matcher.HasCruxInterest("export const approval = toolPolicy({ id: 'approval' })") {
		t.Fatal("matcher did not detect safety tool policy interest")
	}
}

func TestProjectStaticIndexSignalMatcherIncludesDurableTask(t *testing.T) {
	matcher := signalMatcherForCallNames(nil)
	if !matcher.HasCruxInterest("export const embed = durableTask('embed-document', { run: async () => undefined })") {
		t.Fatal("matcher did not detect runtime durable task interest")
	}
}
