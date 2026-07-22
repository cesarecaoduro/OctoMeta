# Store cloud versions as authored JSON bundle chunks

Each cloud version stores one canonical authored JSON bundle containing document blocks, equations, references, graph content, and workbook state, rather than one database row per domain element. The bundle uses one row when it fits and only splits into ordered verified chunks to remain safely below Convex's per-document size limit; metadata and asset reachability remain separately indexed, and undo history is structurally excluded.
