# Resolve and remove browser work at sign-out

Sign-out must first require the user to save, export, or discard every local-only document, dirty working copy, and branch, then delete that account's browser-local documents, undo histories, assets, and cached metadata. This chooses shared-device confidentiality over silently retaining readable IndexedDB work, while preventing accidental loss through an explicit resolution gate.
