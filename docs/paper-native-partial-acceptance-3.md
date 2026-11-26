# Native partial acceptance batch 3 — 75bc3c76340ad6a0ddac8c5f0286aa2de3186343

Node 22.16.0, isolated Linux environment. GitHub DNS unavailable for clone. Retrieved two source files at the pinned revision through the repository connector and verified Git blob SHA-1 with `git hash-object` after materialization:

- `research/live/local-check-core.mjs`: `758fe693569f91b7c96b300676c510c3c5787be3`
- `research/live/local-check-core.test.mjs`: `18a4b50819450c7c9cc7ae6cab5bf554f926866d`

`node --test local-check-core.test.mjs`: 6 passed, 0 failed, 0 skipped. Tests cover healthy read-only checks without readiness promotion, missing/stale/wrong pool scope, mixed slot, same-slot different hash, frontend fingerprint, backend fingerprint. No implementation changes.

The user's browser at `http://127.0.0.1:8790/` showed `Failed to fetch`, no available market snapshot, and no live data. This is a UI observation, not root-cause evidence; Mac process listeners, local configuration, SDK runtime, RPC and service logs were not accessible from the isolated environment. Do not classify the service failure as an RPC or SDK failure without local evidence. Follow `docs/paper-final-local-acceptance.md` sections 1–3 on the actual host. Keep feature freeze; no actual wallet signing, live transactions or PnL claims. This is not full-suite or real-market acceptance. The previous 19 tests are reported in batch 2 and were not rerun in this batch.
