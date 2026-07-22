# OctoMeta Document Workspace

The language of authoring technical documents whose narrative and calculations remain connected.

## Document composition

**Document**:
An ordered technical narrative made from visible blocks and connected to one attached workbook.
_Avoid_: Page, report canvas

**Block**:
One visible, independently arranged unit of document content, such as text, a heading, an equation, an image, or a section.
_Avoid_: Node, widget

**Section**:
A titled container with its own ordered child blocks, presented as one collapsible notebook-like group.
_Avoid_: Heading, divider, sheet

**Workbook**:
The document's single attached calculation space, containing one or more sheets and remaining outside the document's block sequence.
_Avoid_: Spreadsheet block, spreadsheet panel

**Live reference**:
A document value whose displayed content follows a published workbook value.
_Avoid_: Embedded cell, copied value

**Published value**:
A named scalar workbook result intentionally exposed for reuse in the document.
_Avoid_: Cell reference, any non-empty cell

**Published table**:
A named workbook range intentionally exposed as a live-linked document table. This is a future capability and is not a collection of independent published values.
_Avoid_: Pasted table, spreadsheet block

**Broken reference**:
A live reference whose published target is no longer available; it remains visible and retains enough identity to be repaired.
_Avoid_: Plain text fallback, deleted content

**Equation**:
A mathematical block that may combine authored notation with any number of live references.
_Avoid_: Formula bar, bound-value block

**Image block**:
An imported image with optional alternative text and caption, plus authored size and left, center, or right alignment.
_Avoid_: Remote image, image link

## Guidance

**Help center**:
The searchable, offline-capable in-app documentation for completing OctoMeta tasks and resolving problems.
_Avoid_: Tooltip collection, external manual

**Activity event**:
A reviewable session record of a significant save, storage, upload, reconciliation, or recovery outcome.
_Avoid_: Tooltip, transient success message

## Durability

**Local document**:
A document that exists only in one browser workspace and has never been saved to cloud history.
_Avoid_: Draft version, unsaved cloud document

**Working copy**:
The editable browser-local state of a document, including changes not represented by a cloud version.
_Avoid_: Cloud document, autosave version

**Undo history**:
The working copy's browser-local chronological record of authored changes across the document and workbook.
_Avoid_: Cloud history, version history

**Main**:
The authoritative, monotonically advancing lineage of a cloud document.
_Avoid_: Master, working copy

**Branch**:
A named browser-local working copy derived from a specific cloud version for independent experimentation.
_Avoid_: Duplicate document, cloud branch

**Reconciliation**:
A three-way comparison of a branch, its base cloud version, and current main that produces a new main version after every conflict is explicitly resolved.
_Avoid_: Overwrite, history rewind

**Restore**:
The act of copying historical authored content into a working copy so it may become a new cloud version without rewinding main.
_Avoid_: Revert main, delete later history

**Cloud version**:
An immutable snapshot deliberately saved to the document's shared history.
_Avoid_: Autosave, undo state

**Save new version**:
The deliberate creation of a cloud version from the current working copy; it records progress and does not assert that the document's calculations are complete or error-free.
_Avoid_: Autosave, publish as complete
