# `@revue/diff-opentui`

OpenTUI presentation adapter for [`@revue/diff`](../diff/README.md). It owns `DiffBody`,
`DiffFileHeader`, Revue-theme mapping, pointer range selection and context callbacks, React-valued
inline attachments, expansion controls, row-window mounting, measurement, and OpenTUI renderable ID
encodings. It does not re-export engine parsing, models, ranges or planning.

```tsx
import { parsePatch } from "@revue/diff";
import { DiffBody } from "@revue/diff-opentui";

const [file] = parsePatch(patch);
<DiffBody file={file} layout="split" width={100} theme={theme} />;
```

The host chooses layout and width and may supply decorations, range callbacks, attachments,
expanders and a logical-row window. `DiffBody` mounts the engine's complete visual plan; it does not
wrap spans, create continuation rows, or align split cells.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Hunk presentation provenance.
