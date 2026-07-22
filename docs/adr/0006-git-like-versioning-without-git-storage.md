# Provide Git-like versioning without storing documents in Git

OctoMeta adopts the useful product semantics of Git—an authoritative main lineage, immutable versions, named branches, divergence, and reconciliation—without creating a Git repository or exposing Git objects. Documents contain structured calculations, workbook state, and binary assets that still require domain-aware validation and conflict handling, so literal Git storage would add machinery without solving their merge semantics.
