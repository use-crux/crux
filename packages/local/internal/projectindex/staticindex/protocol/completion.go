package protocol

// CompletionMethod identifies the cache-bypassing compiler query on the
// persistent Static Index worker.
const CompletionMethod = "completionQuery"

// CompletionPosition is a zero-based UTF-16 document position.
type CompletionPosition struct {
	Line      uint32 `json:"line"`
	Character uint32 `json:"character"`
}

// CompletionRange is a half-open UTF-16 document range.
type CompletionRange struct {
	Start CompletionPosition `json:"start"`
	End   CompletionPosition `json:"end"`
}

// CompletionCandidate is the compact Project Definition catalogue shape sent
// to the compiler. It intentionally contains no store or cache implementation
// detail.
type CompletionCandidate struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Binding     string `json:"binding"`
	File        string `json:"file"`
	Line        uint32 `json:"line,omitempty"`
	Character   uint32 `json:"character,omitempty"`
	Description string `json:"description,omitempty"`
}

// CompletionQuery is one unsaved source snapshot and its pinned candidates.
type CompletionQuery struct {
	File       string                `json:"file"`
	LanguageID string                `json:"languageId"`
	Source     string                `json:"source"`
	Position   CompletionPosition    `json:"position"`
	Candidates []CompletionCandidate `json:"candidates"`
	Limit      int                   `json:"limit"`
}

// CompletionWorkerRequest wraps one query in the persistent worker envelope.
type CompletionWorkerRequest struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Query  CompletionQuery `json:"query"`
}

// CompletionItem is one eager compiler-owned replacement recipe.
type CompletionItem struct {
	ID                  string               `json:"id"`
	Kind                string               `json:"kind"`
	Label               string               `json:"label"`
	Detail              string               `json:"detail"`
	InsertText          string               `json:"insertText"`
	Replacement         CompletionRange      `json:"replacement"`
	AdditionalTextEdits []CompletionTextEdit `json:"additionalTextEdits,omitempty"`
}

// CompletionTextEdit is one compiler-owned edit applied with the main
// replacement against the same unsaved document version.
type CompletionTextEdit struct {
	Range   CompletionRange `json:"range"`
	NewText string          `json:"newText"`
}

// CompletionResponse is the bounded transient compiler result.
type CompletionResponse struct {
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
}
