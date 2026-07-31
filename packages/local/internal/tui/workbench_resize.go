package tui

import (
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Resize updates the terminal bounds and distributes the resulting active
// screen body size before the next input or render.
func (w *Workbench) Resize(width, height int) {
	w.width = max(0, width)
	w.height = max(0, height)
	overlayCanvas := workbenchOverlayCanvas(w.width, w.height)
	w.definitionChooser.Resize(overlayCanvas.W, overlayCanvas.H)
	w.resizeActiveScreen()
}

func (w *Workbench) resizeActiveScreen() {
	screen, ok := w.activeScreen().(screens.ResizableScreen)
	if !ok {
		return
	}
	screen.Resize(w.activeScreenBodySize())
}

func (w *Workbench) activeScreenBodySize() screens.Size {
	root := kit.Rect{W: w.width, H: w.height}
	column := root
	if kit.Classify(root.W) != kit.LayoutSingle {
		panes := kit.SplitH(root, kit.Fixed(shell.NavRailWidth), kit.Fill())
		if len(panes) > 1 {
			column = panes[1]
		}
	}
	regions := kit.SplitV(kit.Rect{W: column.W, H: column.H}, kit.Fill(), kit.Fixed(1), kit.Fixed(1))
	if len(regions) == 0 {
		return screens.Size{}
	}
	column = regions[0]
	if column.W <= 0 || column.H <= 0 {
		return screens.Size{}
	}
	path, right := w.breadcrumbContent()
	breadcrumbH := len(blockLines(shell.Breadcrumb(column.W, path, right)))
	return screens.Size{
		Width: column.W,
		// The terminating rule is a shared seam: it occupies the final rendered
		// screen row while the screen retains the same logical viewport height.
		Height: max(0, column.H-breadcrumbH+1),
	}
}

func (w *Workbench) breadcrumbContent() ([]string, string) {
	path, right := w.activeScreen().Breadcrumb()
	if right == "" {
		right = w.contextMeta()
	}
	// The workspace owns the project/target prefix; screens return only their
	// route-local breadcrumb segments.
	if project, target := w.devContext.Project.Name, w.devContext.Target.ID; project != "" && target != "" {
		path = append([]string{project + ":" + target}, path...)
	}
	return path, right
}
