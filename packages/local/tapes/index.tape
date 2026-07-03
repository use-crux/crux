Set Shell "bash"
Set Width 1600
Set Height 900
Set FontSize 18
Output packages/local/tapes/out/index.gif

Type "cd packages/local && DUMP_VISUAL=1 go test ./internal/tui/screens -run TestDumpVisualSnapshots -count=1 >/tmp/crux-tui-visual.log && cat /tmp/visual-index.txt"
Enter
Sleep 3s
