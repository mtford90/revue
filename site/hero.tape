# Captures the hero screenshot. Regenerate with:
#   RUN=$(bun packages/tui/src/main.tsx prep 2fef5a0^ 2fef5a0)  # then author chapters.json + threads
#   cd site && REVUE_DEMO_RUN="$RUN" vhs hero.tape
Output assets/hero-capture.gif

Set Shell bash
Set FontSize 20
Set Width 1800
Set Height 1000
Set Padding 12

Hide
Type "cd .. && bun packages/tui/src/main.tsx show $REVUE_DEMO_RUN"
Enter
Sleep 8s
Type "]c"
Sleep 1s
Type "]c"
Sleep 1s
Type "]c"
Sleep 2s
Type "j"
Type "j"
Type "j"
Type "j"
Sleep 2s
Screenshot assets/hero.png
Show
Sleep 1s
Hide
Type "q"
