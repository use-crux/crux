//go:build !linux

package assets

import (
	"embed"
	"errors"
)

type InstalledAnydocRuntime struct{ root, runner, digest string }

func (r InstalledAnydocRuntime) Root() string   { return r.root }
func (r InstalledAnydocRuntime) Runner() string { return r.runner }
func (r InstalledAnydocRuntime) Digest() string { return r.digest }

func InstallAnydocRuntime(embed.FS) (InstalledAnydocRuntime, error) {
	return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable on this platform")
}
