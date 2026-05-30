package screens

// InspectRequest is a tea.Msg screens emit to ask the workbench to pop
// the inspect overlay with a JSON payload. The workbench catches this
// type by name and routes it to its overlay. Defined here so screens
// can return it without importing the tui package (which would create
// an import cycle).
type InspectRequest struct {
	Title    string
	Subtitle string
	Payload  []byte
}
