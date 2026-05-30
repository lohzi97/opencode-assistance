## 1. Configuration Foundation

- [x] 1.1 Add collab config parsing and defaults, then unit-test default, file, and environment override precedence.
- [x] 1.2 Add validation for hard interrupt timeout ordering, then unit-test valid and invalid configurations.
- [x] 1.3 Add template resolution for text, file, and fallback modes, then unit-test replacement semantics and placeholder preservation.

## 2. Storage Foundation

- [x] 2.1 Add the collab SQLite connection and schema migration, then test a fresh database for all PRD tables and constraints.
- [x] 2.2 Add password hashing and verification helpers, then test that plaintext passwords are never stored.
- [x] 2.3 Add CollabService startup/shutdown wiring in the worker, then test disabled startup performs no API binding or delivery work.
