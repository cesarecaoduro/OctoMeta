# Allow one editing tab per working copy

Only one browser tab may hold the edit lease for a specific account, document, and working copy. Other tabs open it read-only and may perform an explicit cooperative takeover after the active editor flushes and releases ownership; this rejects concurrent local writers in favor of deterministic IndexedDB generations and recoverable handoff.
