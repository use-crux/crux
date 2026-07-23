package readmodel

import (
	"errors"
	"fmt"
)

func (m *Manager) warn(message string) {
	fmt.Fprintf(m.options.Logs, "crux lsp: warning: %s\n", message)
	if m.options.OnWarning != nil {
		m.options.OnWarning(message)
	}
}

func (m *Manager) handleProbeError(err error) {
	var mismatch *ProjectRootMismatchError
	if !m.mismatchWarned && errors.As(err, &mismatch) {
		m.mismatchWarned = true
		if m.options.OnShowWarning != nil {
			m.options.OnShowWarning(mismatch.Error())
		}
	}
}

func (m *Manager) warnVersionSkew() {
	if m.versionWarned {
		return
	}
	m.versionWarned = true
	m.warn("Crux LSP and dev server versions differ; using the dev server Project Index")
}
