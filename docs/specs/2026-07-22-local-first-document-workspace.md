## Problem Statement

OctoMeta's prototype can demonstrate connected technical documents and calculations, but it does not yet behave like a dependable authoring tool. Equations lose focus, their controls fail, and mathematical input can become ordinary text. Published workbook values are difficult to discover. The attached workbook can prevent the document from scrolling. Images do not insert reliably. Sections lack the visible notebook structure users expect, and the global toolbar exposes obsolete actions without a clear save action.

More seriously, normal edits currently trigger cloud persistence. Documents, graph elements, blocks, chips, workbook data, and undo history are normalized into many Convex rows and rewritten during routine authoring. New documents and image uploads reach Convex before the user deliberately saves anything. Browser-local durability is neither visible nor reliable, while no explicit immutable cloud-version workflow exists.

Users need confidence that everyday work is stored on their device, that cloud history changes only when they ask, that recovery and branching are understandable, and that the interface explains what is happening.

## Solution

Rebuild the workbench as a browser-first technical-document workspace.

Every accepted owner edit is automatically and transactionally stored in an account-scoped IndexedDB working copy. A new document remains a local document until the owner explicitly selects **Save new version**, at which point OctoMeta creates immutable cloud version 1. Later saves create monotonically numbered versions. Ordinary editing, undo, redo, reconnecting, opening the workbook, inserting images, and creating branches never publish automatically.

The document becomes an ordered notebook of visible blocks and one-level section containers. A custom `/` menu provides Notion-like insertion while TipTap remains the document engine. The workbook remains the single attached calculation space in a resizable right drawer. Users explicitly publish meaningful scalar workbook values and can insert them as stable live references in prose and equations.

Equations use a direct visual math editor, can mix authored notation with multiple live references, and never require an Apply action. Images are imported into browser storage from file selection, drag-and-drop, or clipboard paste, and support captions, alternative text, resizing, and alignment. Only images referenced by an explicitly saved cloud version are uploaded.

Cloud versions store canonical authored JSON snapshots in one row when possible and a small number of verified chunks when required by database limits. Undo history remains local. Git-like product semantics provide main, local branches, divergence detection, conservative reconciliation, and forward-only restoration without using Git as the storage engine.

A compact document header distinguishes local durability from cloud-version state and includes the saving action. Searchable offline help, contextual tooltips, severity-aware toasts, and a reviewable session activity panel help users understand the system.

## User Stories

1. As an authenticated owner, I want to create a local document without creating cloud records, so that experimentation does not consume cloud storage or create unwanted history.
2. As an owner, I want a new local document to open immediately, so that cloud latency does not interrupt authoring.
3. As an owner, I want every accepted edit automatically stored in my browser, so that ordinary work survives reloads without manual saving.
4. As an owner, I want local autosave to coalesce rapid input, so that persistence does not make typing sluggish.
5. As an owner, I want continuous editing stored within a bounded interval, so that a long typing session cannot remain indefinitely vulnerable.
6. As an owner, I want document state and undo history committed atomically, so that reload cannot restore mismatched content and history.
7. As an owner, I want an inserted image and its first referencing document generation committed atomically, so that the document cannot reference a missing local asset.
8. As an owner, I want to see **Saving locally…**, so that I know durability is still in progress.
9. As an owner, I want to see **Stored on this device** only after IndexedDB confirms the transaction, so that the status is trustworthy.
10. As an owner, I want a persistent local-save error when quota or transaction failures occur, so that I do not mistake vulnerable work for durable work.
11. As an owner, I want recovery guidance after a local-save failure, so that I can retry or export before losing work.
12. As an owner, I want previously opened working copies to remain editable offline, so that connectivity does not stop technical work.
13. As an owner, I want to create local documents and branches offline, so that planning and experimentation remain available anywhere.
14. As an owner, I want reconnecting to avoid automatic cloud publication, so that cloud history changes only with my consent.
15. As an owner, I want cloud-only documents clearly identified when offline, so that unavailable content is not confused with missing content.
16. As an owner, I want one unified document index for local and cloud content, so that I do not have to navigate separate storage views.
17. As an owner, I want local documents labelled **On this device**, so that I understand they are not backed up in cloud history.
18. As an owner, I want cloud-backed working copies to show their base version and local-change state, so that I understand what has and has not been published.
19. As an owner, I want local branches grouped with their document, so that experiments remain understandable.
20. As an owner, I want cloud-only documents labelled clearly, so that I know they must be downloaded before offline editing.
21. As an owner, I want to rename, export, save, duplicate, or discard a local document from the index, so that its lifecycle is under my control.
22. As an owner, I want a prominent **Save new version** action, so that cloud persistence is deliberate and discoverable.
23. As an owner, I want the save action enabled only when authored content differs from its cloud base, so that no-change versions are avoided.
24. As an owner, I want a save dialog to show the next version number and change summary, so that I understand the publication.
25. As an owner, I want to add an optional version message, so that important milestones have human context without making every save tedious.
26. As an owner, I want incomplete calculations and broken references shown as warnings, so that I can knowingly save work in progress.
27. As an owner, I want missing assets or corrupt serialization to block cloud saving, so that cloud versions are always recoverable.
28. As an owner, I want a failed cloud save to leave my local work untouched and retryable, so that network or backend failures do not destroy progress.
29. As an owner, I want a successful save to show **Cloud version N saved**, so that local and cloud durability are unambiguous.
30. As an owner, I want edits made during cloud upload to remain dirty after the older generation saves, so that successful publication cannot overwrite newer local work.
31. As an owner, I want Cmd/Ctrl+S to follow the same explicit save or reconciliation workflow, so that familiar shortcuts remain safe.
32. As an owner, I want historical cloud versions to be immutable, so that audits and comparisons remain trustworthy.
33. As an owner, I want normal edits to make zero Convex product writes, so that cloud usage reflects deliberate durability choices.
34. As an owner, I want undo and redo to cover prose, sections, blocks, equations, images, workbook changes, and published values in one chronology, so that history matches my actions.
35. As an owner, I want undo history to survive local reloads, so that restarting the browser does not remove my safety net.
36. As an owner, I want each branch to have independent undo history, so that experiments do not contaminate main history.
37. As an owner, I want cloud saving to preserve my local undo history, so that publishing does not end my editing session.
38. As an owner, I want undo history excluded from cloud versions and portable files, so that editing mechanics do not become shared authored content.
39. As an owner, I want only one browser tab to edit a working copy, so that concurrent local autosaves cannot overwrite one another.
40. As an owner opening a second tab, I want it to be read-only and identify the active editor, so that the restriction is understandable.
41. As an owner, I want an explicit cooperative takeover, so that I can continue safely after the original tab flushes and releases ownership.
42. As an owner, I want a visible block boundary and insertion point, so that document structure is obvious.
43. As an owner, I want `/` to open a searchable block menu, so that I can insert content without a permanent toolbar.
44. As a keyboard user, I want to navigate, select, and dismiss the block menu without a pointer, so that insertion is accessible.
45. As an owner, I want initial block choices for text, heading, section, equation, and image, so that the primary document vocabulary is complete.
46. As an owner, I want block movement and deletion controls beside the active block, so that actions are contextual.
47. As an owner, I want a section to contain an ordered set of child blocks, so that related technical content moves as one unit.
48. As an owner, I want sections to have visible notebook-like boundaries, so that document organization is legible.
49. As an owner, I want to collapse and expand a section, so that long documents remain manageable.
50. As an owner, I want section collapse to remain a local preference, so that it does not alter authored cloud content.
51. As an owner, I want moving or deleting a section to operate on the complete group, so that children cannot be accidentally orphaned.
52. As an owner, I want undo to restore a deleted section and all its children, so that structural mistakes are recoverable.
53. As an owner, I want empty sections to be valid, so that I can establish structure before writing content.
54. As an owner, I want sections limited to one nesting level, so that document hierarchy remains predictable.
55. As an owner, I want notebook-style sections without execution numbers or run buttons, so that the document does not pretend to be the calculation engine.
56. As an owner, I want to click an equation and immediately type formatted mathematics, so that equation authoring feels direct.
57. As an owner, I want the equation editor to keep focus during typing, so that input is not interrupted.
58. As an owner, I want equation dropdowns and reference pickers to remain interactive, so that TipTap cannot steal focus from controls.
59. As an owner, I want mathematical input to remain an equation block, so that it never silently becomes ordinary text.
60. As an owner, I want equation changes to update directly without an Apply action, so that visual editing is fluid.
61. As an owner, I want invalid intermediate notation to remain editable and visibly flagged, so that temporary syntax does not destroy my work.
62. As an owner, I want Escape to restore the equation state from the start of the edit session, so that I can cancel safely.
63. As an advanced owner, I want an optional raw-TeX mode, so that uncommon notation remains possible.
64. As an owner, I want one equation to mix authored notation with multiple live references, so that formulas are expressive rather than constrained to a single bound value.
65. As an owner, I want to insert a live reference at the equation cursor, so that references appear where intended.
66. As an owner, I want a searchable reference picker showing published name, value, unit, sheet, and cell, so that I can choose confidently.
67. As an owner with no published values, I want the picker to explain the requirement and link to publication, so that an empty dropdown is actionable.
68. As an owner, I want to publish only explicitly chosen workbook cells, so that arbitrary worksheet data does not clutter document references.
69. As an owner, I want to publish a selected cell with a unique semantic name, optional label, unit, and description, so that references communicate engineering meaning.
70. As an owner, I want a searchable published-values manager inside the workbook, so that publication is managed at its source.
71. As an owner, I want selecting a published value to navigate to its source cell, so that provenance is easy to inspect.
72. As an owner, I want renaming a published value to preserve all references, so that display names are not identities.
73. As an owner, I want unpublishing to disclose every use before confirmation, so that I understand the impact.
74. As an owner, I want confirmed unpublishing to leave visible repairable broken references, so that authored intent is not silently deleted or frozen as text.
75. As an owner, I want republishing the same underlying value to offer reference repair, so that broken content can recover.
76. As an owner, I want the workbook in a resizable right drawer on desktop, so that I can allocate space according to my task.
77. As an owner, I want document and workbook scrolling to remain independent, so that opening the workbook never traps document navigation.
78. As a keyboard user, I want to resize the workbook without a pointer, so that the layout control is accessible.
79. As an owner, I want workbook width remembered locally, so that my preferred layout returns without becoming authored content.
80. As an owner, I want to collapse the workbook completely, so that I can focus on narrative work.
81. As an owner, I want a focus-workbook action, so that spreadsheet-heavy work can temporarily use more space.
82. As a narrow-screen user, I want the workbook to become a full-screen overlay with a clear return action, so that neither surface becomes unusably compressed.
83. As a keyboard user, I want focus restored after leaving the workbook overlay, so that navigation remains predictable.
84. As an owner, I want to import an image from a file picker, so that standard file workflows work.
85. As an owner, I want to drag and drop an image, so that insertion is quick.
86. As an owner, I want to paste an image from the clipboard, so that screenshots can be documented immediately.
87. As an owner, I want image bytes stored locally before cloud publication, so that image authoring works offline.
88. As an owner, I want unsupported, oversized, or malformed images rejected before insertion, so that one asset cannot make the document non-durable.
89. As an owner, I want images to preserve aspect ratio while resizing, so that visual content is not distorted.
90. As an owner, I want images aligned left, center, or right, so that technical layouts are controllable.
91. As an owner, I want optional caption and alternative-text fields, so that images can be explained and made accessible.
92. As an owner, I want only images referenced by an explicit cloud save uploaded, so that unused local assets do not reach Convex.
93. As an owner, I want cloud history to retain every asset referenced by a retained version, so that older versions remain complete.
94. As an owner, I want the obsolete top toolbar removed, so that unrelated actions no longer crowd the document.
95. As an owner, I want a compact header containing title, workspace, durability state, save action, workbook toggle, and overflow menu, so that global actions are coherent.
96. As an owner, I want version history, export, branch actions, and undo/redo available in the overflow menu and shortcuts, so that removing permanent buttons does not remove capability.
97. As an owner, I want the Parameters rail removed, so that published values are managed consistently from the workbook.
98. As an owner, I want to create a named local branch from current main, so that I can experiment without changing cloud history.
99. As an owner, I want to create a branch from a historical version, so that older approaches can be explored safely.
100. As an owner, I want branches to record their immutable base version, so that divergence can be detected correctly.
101. As an owner, I want branches to remain device-local and exportable, so that unfinished experiments are not silently published.
102. As an owner, I want reconciliation to compare the branch, its base, and current main, so that independent changes can be identified accurately.
103. As an owner, I want independent block and published-value metadata changes merged automatically, so that safe reconciliation is efficient.
104. As an owner, I want same-block conflicts presented for explicit resolution, so that no authored text is silently chosen.
105. As an owner, I want simultaneous workbook changes treated as one conflict initially, so that unsafe cell-level merging is avoided.
106. As an owner, I want every resolved reconciliation to create a new main cloud version, so that existing history remains immutable.
107. As an owner, I want a reconciled branch retained read-only, so that its context and local history are not automatically destroyed.
108. As an owner, I want to continue a reconciled branch from the new main or delete it explicitly, so that its later lifecycle is deliberate.
109. As an owner, I want historical versions to open read-only, so that viewing history cannot mutate it.
110. As an owner, I want restoration to copy historical content into a reviewable working copy, so that I can inspect it before publication.
111. As an owner, I want restoring to create a later cloud version rather than rewind main, so that intervening history remains intact.
112. As an owner, I want to export a self-contained `.octometa` document with referenced assets, so that browser storage is not my only recovery mechanism.
113. As an owner, I want imported archives completely validated before creating content, so that malformed or hostile files cannot partially modify my workspace.
114. As an owner, I want imported files to create an independent local document, so that untrusted lineage metadata cannot overwrite an existing cloud document.
115. As an owner signing out, I want every dirty working copy, branch, and local document presented for save, export, or discard, so that local work is not silently lost.
116. As an owner on a shared device, I want my local namespace removed after sign-out, so that another account cannot read my work.
117. As an existing user, I want my authentication account preserved during the prototype data reset, so that I can continue signing in.
118. As an operator, I want the reset limited to product data and document assets, so that authentication and the marketing waitlist remain intact.
119. As an operator, I want a reset dry run with exact counts and an explicit environment acknowledgement, so that destructive scope is verifiable.
120. As a user, I want successful actions confirmed with brief toasts, so that routine outcomes are visible without interruption.
121. As a user, I want warnings and errors to remain until acknowledged or resolved, so that important failures are not missed.
122. As a user, I want significant save, storage, upload, reconciliation, and recovery outcomes retained in a session activity panel, so that I can review what happened after a toast disappears.
123. As a screen-reader user, I want notifications announced without duplicate chatter or stolen focus, so that feedback remains accessible.
124. As a user, I want tooltips on unfamiliar controls, so that I can learn the interface in context.
125. As a user, I want critical state presented outside tooltips, so that essential information remains discoverable and accessible.
126. As a user, I want a searchable in-app help center, so that I can learn complete workflows without leaving OctoMeta.
127. As an offline user, I want core help topics available without connectivity, so that guidance is present when cloud services are not.
128. As a user, I want help organized around tasks such as documents, blocks, workbook values, equations, images, saving, versions, branches, and recovery, so that answers map to my goals.
129. As a user encountering an empty state or error, I want a deep link to the relevant help topic, so that troubleshooting begins from context.
130. As a maintainer, I want affected help topics updated with every behavior change, so that product documentation remains trustworthy.

## Implementation Decisions

- `DocumentGraph` remains the framework-neutral source of truth for calculations, block hierarchy, stable publication identities, workbook manifest, and unified history. TipTap, MathLive, Univer, and Svelte remain projections or adapters.
- Product document, version, workspace, branch, block, section, published-value, asset, and operation identities are application-generated stable IDs. Convex row identities remain private to the cloud adapter.
- Browser-local persistence uses IndexedDB through a small repository adapter that preserves native store and transaction concepts.
- Local autosave uses a 500 ms trailing delay and a 2 second maximum dirty interval, with immediate flushes at semantic boundaries.
- Working content and undo state commit atomically using an expected-generation compare-and-swap. Asset insertion and the first referencing generation use one multi-store transaction.
- Local storage is account-scoped. Explicit sign-out requires resolution of unfinished work, then removes that account's browser namespace.
- One browser tab owns the edit lease for a given working copy. Other tabs are read-only and can request cooperative takeover.
- New documents exist only in IndexedDB until explicit first save. Opening or listing a local document must not create product records in Convex.
- The unified index merges local summaries and authorized cloud metadata without persisting viewer-authored bundles.
- Local and cloud durability are separate state machines and separate UI labels.
- An explicit cloud save captures one settled immutable authored generation, uploads only newly referenced assets, and creates a version with expected-head compare-and-swap.
- Save requests carry a persistent operation ID and input hash so retry after a lost response is idempotent.
- A no-change save returns unchanged and does not create a version.
- Cloud versions include title, authored graph fields, blocks, sections, equations, workbook manifest/snapshot, published values, and referenced-asset manifest. They exclude undo history, selection, activity events, drawer dimensions, section collapse, and other local UI preferences.
- Each cloud version is one canonical JSON bundle. It uses one database row when safely within the current Convex document limit and ordered hash-verified chunks only when required. Metadata and version-asset reachability remain separately indexed.
- Cloud storage does not create individual rows for graph nodes, blocks, chips, equations, workbook cells, undo entries, or branches.
- Historical versions are immutable and monotonically numbered. Main never rewinds; restore and reconciliation create later versions.
- Existing prototype product data will not be migrated. A guarded reset deletes document/product data and document assets while preserving Better Auth identities and the marketing waitlist.
- TipTap remains the document engine. The maintained suggestion primitive supports a custom Svelte `/` menu; the experimental prebuilt slash-command example is not adopted as a dependency.
- The document model has root blocks plus exactly one level of section-owned child blocks. Sections cannot contain sections. Section collapse is local preference state.
- Block movement, insertion, deletion, and group operations remain domain mutations and participate in unified history.
- The equation payload becomes a versioned structured expression with authored LaTeX segments and stable published-value reference segments. Rendered TeX, display names, and cell addresses are never reference identities.
- MathLive supplies direct visual input and cursor insertion. KaTeX may remain for safe static/read-only rendering. The equation NodeView must isolate editor focus and prevent projection repaints from replacing active controls.
- Equations accept incomplete or invalid intermediate input locally. Invalid content is clearly flagged; cloud save warns unless the content cannot be serialized safely.
- Only explicitly published scalar workbook values appear in reference pickers in this release.
- Published values have stable identities plus unique semantic names and optional label, unit, and description. Rename preserves identity. Confirmed unpublish leaves repairable broken references.
- Published ranges are reserved as a future `Published table` concept rather than represented as many scalar publications.
- The workbook becomes an independently scrolling right drawer on desktop and a full-screen overlay on narrow layouts. Width and collapse/focus presentation are local preferences.
- Images use stable local asset identities rather than cloud storage identities in authored content. Imported bytes are validated and stored locally; upload binding is cloud-adapter metadata.
- Image presentation includes bounded width, aspect-ratio preservation, left/center/right alignment, optional caption, and optional alternative text.
- The obsolete toolbar is replaced by a compact document header. Block-specific actions move to contextual controls and the `/` menu. The Parameters rail is removed.
- Main is the authoritative cloud lineage. Branches are named browser-local working copies with a retained complete base snapshot and independent undo history.
- Reconciliation is three-way. Independent blocks and published-value metadata can merge automatically; same-block conflicts require user resolution; concurrent workbook changes conflict as one unit initially.
- A successful branch reconciliation creates a new main version and marks the branch reconciled/read-only until continued or deleted.
- Portable `.octometa` files are versioned, self-contained, bounded archives with authored JSON, workbook state, and referenced assets. They exclude undo and import as independent local documents.
- Core application shell, previously opened owner workspaces, and help content support offline use. Reconnection never triggers cloud publication.
- A shared notification service distinguishes transient toasts from reviewable session activity events. Severity determines dismissal behavior.
- Help documentation is version-controlled, searchable, task-oriented, deep-linkable, and bundled for offline use.
- Public methods introduced by the implementation are documented, and package additions use the latest stable compatible releases at implementation time.

## Testing Decisions

- The primary seam is the user-observable workbench running in a real browser. Playwright tests should create and edit documents through the UI, inspect IndexedDB-visible durability, and observe Convex product-call behavior. This is the highest seam that proves the central promise without coupling tests to implementation structure.
- Tests assert external behavior and accessibility state: what is visible, focus ownership, persisted content after reload, cloud version results, conflict outcomes, and function-call absence. They do not assert internal helper invocation or Svelte component state.
- The existing complete-workbench Playwright scenarios are prior art. Workbook tests must follow the established learning of asserting refreshed accessibility-tree labels and stable IDs after engine settlement.
- A browser regression must reproduce the supplied equation failures: click the visual equation, type continuously, interact with the source/reference controls, and verify focus remains and content stays an equation.
- A mixed editing browser scenario must prove zero Convex product writes before explicit save and exactly one idempotent version operation when saving.
- Real-browser tests cover local-only creation, IndexedDB reload, offline editing, quota/transaction error presentation where browser facilities permit, and cooperative tab takeover.
- Real-browser tests cover independent document/workbook scrolling, pointer and keyboard drawer resizing, collapsed/focused states, narrow full-screen overlay, and return focus.
- Real-browser tests cover slash-menu keyboard and pointer interaction, section grouping, nesting rejection, move/delete/undo, and reload round trips.
- Real-browser tests cover value publication, discoverable picker contents, source navigation, rename stability, usage disclosure, unpublish, broken references, and repair.
- Real-browser tests cover file selection, drag/drop, clipboard images, validation, local reload, resize, alignment, undo, explicit upload, and missing-blob recovery.
- Real-browser tests cover cloud save warnings, blocking integrity failures, optional messages, no-change saves, failed retries, edits during upload, and stale-head rejection.
- Real-browser tests cover branch creation, divergence, automatic independent merges, same-block conflicts, workbook conflicts, reconciliation, completed branch state, history, and restore-as-new-version.
- Real-browser tests cover help search, offline topics, contextual deep links, tooltips, toast dismissal, persistent warning/error behavior, activity review, and non-disruptive live-region announcements.
- Focused fake-IndexedDB tests are used only for store upgrades, blocked upgrades, transaction aborts, generation fencing, quota failures, atomic asset/reference commits, and account-namespace deletion.
- Focused engine tests cover section containment, unified inverse operations, structured equation segments, stable reference lifecycle, authored projection, and three-way merge permutations.
- Focused Convex tests cover authorization, version uniqueness, expected-head compare-and-swap, operation idempotency, no-change handling, chunk integrity, transaction bounds, asset reachability, and atomic rollback.
- Reset tests dry-run and execute against a disposable deployment or isolated test database, proving the hardcoded product allowlist cannot target Better Auth data and that waitlist/auth counts remain unchanged.
- Serialization tests explicitly reject undo, selection, activity events, and local preferences from cloud and portable formats.
- Accessibility testing combines semantic Playwright assertions with axe checks for the workbench, header, save dialog, equation editor, reference picker, image controls, slash menu, workbook drawer, conflict resolver, activity panel, and help center.
- Performance verification measures local capture/commit latency at configured maximum document and asset sizes and bounds one cloud save to the required chunks and referenced assets.
- Completion requires type checks, all Vitest projects, production build, Playwright, dependency audit, and secret scan.

## Out of Scope

- Literal Git repositories, Git commits, Git trees, or Git merge machinery.
- Realtime collaboration, presence, collaborative undo, or comments.
- Cloud backup of unfinished local branches.
- Silent background cloud synchronization or publication on reconnect.
- Arbitrary non-empty workbook cells in live-reference pickers.
- Published cell ranges and live embedded tables in this release; the future domain concept remains reserved.
- Charts, geometry viewers, PDF/Word/IFC export, and AI authoring features.
- Arbitrary recursive section nesting.
- Automatic cell-level or workbook-presentation merging.
- Rewinding, mutating, or deleting individual retained main versions.
- Viewer offline authored-bundle caching or viewer editing/export/branching.
- OPFS or a second local persistence substrate.
- Browser-side encryption or offline key recovery.
- Migrating existing prototype documents or preserving their undo history.
- External image hotlinks; remote images must be imported as owned bytes when support is added.

## Further Notes

- This spec is the synthesis of the approved grilling session, the OctoMeta domain glossary, ADRs 0001–0016, and the consolidated implementation plan.
- The recommended delivery order is: guarded reset and local foundation; immutable explicit cloud versions; images; workbench/workbook publication; equations; notebook sections and slash menu; branches/history/portability; help/feedback and legacy cleanup.
- Destructive reset execution is implementation work and has not been performed while preparing this spec.
- CalcTree is a product-direction reference for linking spreadsheet parameters, tables, and charts into a block-based technical page. The first OctoMeta release intentionally stops at explicitly published scalar values; live published tables remain future work.
- Convex's current per-document limit requires safe chunking rather than a single unbounded JSON row.
- TipTap's maintained suggestion utility is the supported primitive. Its published slash-command implementation is experimental and should not be treated as a maintained package.
- The implementation must retain the repository rule that engine objects remain framework-neutral and Svelte receives fresh presentation identities at explicit settle boundaries.
