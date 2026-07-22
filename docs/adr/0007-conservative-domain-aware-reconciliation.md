# Reconcile branches conservatively by domain boundary

Reconciliation automatically combines only changes proven independent against the branch's base version: separate document blocks and independently changed published-value metadata may merge, while same-block edits require resolution and concurrent workbook changes conflict as one unit initially. The system never silently chooses a side, and every resolved reconciliation creates a new immutable main version rather than rewriting history.
