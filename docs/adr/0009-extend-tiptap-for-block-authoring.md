# Extend TipTap for OctoMeta block authoring

OctoMeta retains TipTap as its document engine and builds its slash menu, contextual block controls, and nested section node as a thin product-specific layer using maintained TipTap primitives. Prebuilt Notion-style editors are rejected because adopting one would require replacing the existing equation, live-reference, unified-history, and persistence integrations, while TipTap's published slash-command example itself is experimental and will not be copied as a dependency.
