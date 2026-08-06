# `@revue/diff-opentui`

OpenTUI presentation adapter for [`@revue/diff`](../diff/README.md). It owns `DiffBody`,
`DiffFileHeader`, Revue-theme mapping, pointer range selection and context callbacks, React-valued
inline attachments, expansion controls, row-window mounting, measurement, and OpenTUI renderable ID
encodings. It does not re-export engine parsing, models, ranges or planning.

```tsx
import { parsePatch, planDiff } from "@revue/diff";
import { DiffBody, OPENTUI_DIFF_CHROME } from "@revue/diff-opentui";

const [file] = parsePatch(patch);
const plan = planDiff({
  file,
  layout: "split",
  width: 100,
  visibility: { lineNumbers: true, hunkHeaders: true },
  chrome: OPENTUI_DIFF_CHROME,
});
<DiffBody plan={plan} file={file} layout="split" width={100} theme={theme} />;
```

Hosts that measure or navigate a diff should pass the same plan to `DiffBody`; Revue's TUI does so
for viewport heights, source anchors, attachment indices and rendering. A standalone body may omit
`plan`, in which case the adapter plans once from its stable file/layout/width/visibility inputs.
Either path uses the adapter's single `OPENTUI_DIFF_CHROME` declaration. Decorations, hunk focus and
pointer selection are painted only over the supplied logical-row window and never rebuild wrapping.

The host still chooses responsive layout and the mounted row window. `DiffBody` does not wrap spans,
create continuation rows, align split cells or choose viewport policy.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Hunk presentation provenance.
