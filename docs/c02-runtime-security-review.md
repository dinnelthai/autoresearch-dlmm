# C02 runtime and dependency review

Review baseline: local commit `9e66a68` on top of fetched `origin/main` `565c33e`, Node 22.23.4. Overall **BLOCKED**, not production acceptance. Existing offline verifier checks source behavior and does not prove live chain or protocol compatibility.

## C02.3 SDK adapter

Code review: `sdk-runtime.mjs` uses `createRequire` to load the unmodified package's CJS entry and re-exports the project-required symbols. Search of `research` for `@meteora-ag/dlmm` found no direct SDK function imports outside the adapter; two `require.resolve` uses read package metadata. The adapter does not independently authenticate package contents or reject missing exports on module load; callers and tests rely on the locked installed artifact. Project SDK calls remain coupled to this CJS contract. **Provisional engineering assessment only:** CJS is a viable local compatibility approach; it is not a replacement for the explicitly prescribed direct ESM acceptance check or an independent approval of a changed contract.

Direct ESM import on Node 22 still fails `ERR_UNSUPPORTED_DIR_IMPORT` at `@coral-xyz/anchor/dist/cjs/utils/bytes`. Preserve this failure. Runtime checks using the installed SDK: signed bin indices -71/-70/-1/0/69/70 and 70-bin bounds; PDA derivation for those signed indices compared with independently assembled seeds and web3 `findProgramAddressSync`; weights for 25/75 allocations yielded 16383/49151. JS bigint-buffer fallback roundtripped 0, 1, 2^53+1 and maximum values at 64/128/192/256 bits in both endian orders where in range. Tests cover examples, not all integer inputs or independent protocol equivalence. Historical capture `data/raw/accounts-3IgaD8` decoded through the pinned IDL and returned `POOL_DECODED_UNVERIFIED` with four missing mint/vault accounts; this is a runtime check only, not a fresh T01/T02 acceptance or independently verified decode.

## C02.4 WebSocket

9.3.8 uses uuid ^11; 9.3.9 uses uuid ^14. The current lock resolves 9.3.9; upstream build overrides 9.3.8. Each was installed separately and tested using a local `rpc-websockets` server and client on Node 22: connect, subscribe, receive, unsubscribe, abrupt termination, automatic reconnect, explicit resubscribe, receive, close and server close all passed. An initial test-harness attempt incorrectly called `setReconnect`, failed, and was corrected to `setAutoReconnect`. A second local mock JSON-RPC test with actual web3 `Connection` and each version passed slot notification, forced disconnect, automatic re-subscription, second notification, unsubscribe and eventual socket closure. Its first attempt used the wrong ws server constructor and was corrected. This does not prove heartbeat, long-duration leaks or real RPC compatibility. Retain locked 9.3.9 provisionally: neither tested version established a reason to change it, and its uuid 14 is not the flagged uuid 8. Independent compatibility and security review remain open.

## C02.5 Audit

Both stored JSON reports were read. Direct advisories deduplicated by GHSA (CVE identifiers not present in the npm audit entries are not inferred):

| Package / phase | GHSA IDs | Dependency path and review |
|---|---|---|
| esbuild / build | GHSA-67mh-4wv8-2f99 | upstream `ts-jest > esbuild` 0.17.19; dev-server issue, build command did not start dev server; broader build exposure not independently established |
| tsup / build | GHSA-3mv9-4h5g-vhg3 (CVE-2024-53384) | upstream `tsup` 6.7.0; generated bundle exposure not assessed |
| bigint-buffer / runtime | GHSA-3gc7-fjrx-p6mg | SDK/root `@solana/spl-token > @solana/buffer-layout-utils > bigint-buffer`; JS fallback observed because native binding was not built, fixed-width layouts use 8/16/24/32-byte inputs; no general proof of all attack paths or other installations' native binding |
| stream-json / runtime transitive | GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc | `@solana/web3.js > jayson > stream-json`; jayson `lib/utils.js` imports stream parser/verifier; web3 uses browser client, but full reachability under every configuration remains unverified |
| toml / runtime transitive | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j, GHSA-4qx8-w7c3-pj3p, GHSA-9j65-hcg3-gc64, GHSA-9qmh-m7c6-f92p, GHSA-h895-cgqg-jf52 (CVE-2026-114142 in upstream audit) | `@coral-xyz/anchor > toml`; Anchor workspace proxy parses local `Anchor.toml` when workspace property is accessed. No project workspace access identified; complete transitive reachability and upstream severity still require independent review |
| uuid / runtime transitive | GHSA-w5hq-g745-h8pq | `@solana/web3.js > jayson > uuid@8`; jayson calls v4 rather than affected buffer forms of v3/v5/v6. Separately `rpc-websockets@9.3.9 > uuid@14`; do not conflate versions. Full reachability not proved |

Upstream audit configuration suppresses several GHSAs; they are not treated as resolved. Stored audit reports and hashes are in `c02-source-build-results-2026-11-26.md`; current findings rely on those dated reports, not a fresh vulnerability feed. High-severity findings remain open pending risk-owner review and reachability evidence. No forced upgrade or blanket suppression was applied.

## C02.6 isolated install and remaining gates

Copied only consumer manifest/lock and SDK tarball into `/private/tmp/dlmm-c02-review` and ran Node 22 `npm ci --ignore-scripts`: 159 packages installed. Tarball SHA256 `7e8da2ee2e528a5aba4c1efd3909dcd74ac94cfed380fa9636f256ade1a41b3b`, lock SHA256 `dad5c239e5da6b8bb3efe2a59de814a234fd2b1b16fee347f9e96c361b2bd197`, both matched originals. This is a clean consumer directory on the same host, not an independently built SDK or full clean machine. Native install scripts were not run; JS fallback is observed and native-path equivalence remains unverified. Original tarball lives in ignored `data/vendor` and needs durable artifact custody.

Node 22 full offline verifier: 88 modules, 34 test files, 135 records passed, zero failed/blocked. `data/acceptance/offline-1795676572298.json` SHA256 `15576c2f7c716970c905695717dbbd24ecc7893338959d3d68e8fc7e9bb87271`. Loopback test scripts retained under ignored `data/acceptance`: `c02-ws-check.cjs` SHA256 `6383e8fa9948aeaaaf372e705b3b645ec7d48511dae642b67c4f8d6452365340`; `c02-solana-ws.cjs` SHA256 `9a7939b29f606a321f933b28afe65430aa3b87f5e1ca1c9f365cf757fdb03526`. The temporary 9.3.8 installation was made only after the clean `npm ci` result and did not alter the project lock.

Formal C02 remains blocked by the unapproved CJS-vs-ESM contract and incomplete dependency reachability/security review, as well as the remaining WebSocket limits above. T01–T06 are not run because user requires C02 to pass first. Retain 1.9.15 and current dependency lock pending evidence; no risk standard was relaxed.
