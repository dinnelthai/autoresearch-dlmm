# Business-first local live integration — 2026-11-27

Scope is virtual capital, read-only public market data, no wallet signing or transaction submission. The existing SDK 1.9.15 CJS adapter is used for local research; the direct ESM defect, dependency advisories and independent protocol calibration remain open technical debt. This does not imply that the original formal C02 passed.

Node 22.23.4, base commit `6b940cb9f550e2d68b23d705f7d6746060b2ec48`: collector and terminal started on 8788 and 8790 using the existing basket configurations. Publicnode returned HTTP 403 on the full account request; the Solana public mainnet RPC returned the pool, mints, vaults and eight bitmap-marked Bin Arrays in one finalized context. The absent bitmap extension is reported as absent, not replaced. The local checks returned `LOCAL_READ_CHECKS_PASSED`, but model input and review remained blocked and this is not a live strategy acceptance.

Example observation: pool `EXWUUH9Au6XimBjgaJ5RxP1ZfWz6JVxzjs8cNRyyxLNr`, slot `474249685`, active bin `-474`, eight arrays decoded, raw SHA-256 `feaef0672cd1e504bc459047700d3125fc2dca6d014def646c391359cf31581b`. Raw capture is retained locally at `data/raw/accounts-TVFD9v`; it is not committed. The local check report is `data/acceptance/local-read-1795717967738.json`. This is an unverified real observation, not a simulated return.

Current service startup commands, from the project root (run in separate terminals):

```sh
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com data/vendor/toolchain/node-v22.23.4-darwin-x64/bin/node research/live/state-service.mjs --config data/live-config-basket.json --port 8788
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com data/vendor/toolchain/node-v22.23.4-darwin-x64/bin/node research/live/terminal-server.mjs --config data/terminal-config-basket.json --port 8790
```

Stop the corresponding foreground process with Ctrl-C. Inspect listeners and locks before restarting; do not remove an active writer lock. The previous stale lock was preserved locally after its recorded PID was confirmed absent.

The page was opened again after switching RPC: it displayed slot `474249685`, 560 bins and the active-bin price, labeled unverified. Three finalized account captures with independently recomputed raw hashes had increasing slots `474249633`, `474249685`, `474249952`; the first was the direct diagnostic capture, the latter two were collector captures. A three-snapshot paper run has not been verified. Existing paper start relies on a reviewed strategy preview, while this pool has no configured review and lacks reference, flow, holder and token evidence. Any business-first path must distinguish required observed market/account facts from optional research signals, retain hard accounting and risk checks, label estimates, and avoid fabricating missing inputs. Fixed strategy plans and HODL must remain comparable on identical virtual capital and time windows.
