# Native partial acceptance batch 4 — 0a012a82b2658cc06433f3c6a739d6a1b8289820

Feature freeze: no production or test implementation changes. Node 22.16.0, isolated Linux environment. Direct git clone blocked by GitHub DNS; retrieved pinned files via repository connector and verified every materialized file with git hash-object.

| File | Git blob SHA-1 |
| --- | --- |
| research/integer.mjs | 71b00637ae241d0b6dc8b96a158b2ad6bced0c1d |
| research/integer.test.mjs | 525281ce7597f99129f61d2410172f81e7871c71 |
| research/live/allocation-diagnostic.mjs | bfc3e1393ac7668dab29b9228b248afbfea52299 |
| research/live/paper-fee-core.mjs | d68460a9b679f38f2edd695a389f396b1f45ecbf |
| research/live/paper-fee-core.test.mjs | f7df5ca2a6ebd480e30eef8af64e9332a0ecf387 |
| research/live/paper-share-core.mjs | fd01618c8ba7a786d81dfa9560b0135eb73c3ed5 |
| research/live/paper-share-core.test.mjs | 8bb01ff0d82a2474c170cf52cbcf9240dfbbcb60 |
| research/live/reference-math.mjs | ba7f16d9f1039ac467c9ec88a48796b782349ae9 |
| research/live/reference-math.test.mjs | d7615c07a89b52747578d35d8d476a620e7bd2d2 |
| research/live/research-contract.mjs | de29fbcdd0d1d3738a27eca5821d16ce36c7c168 |

Executed together:

```sh
node --test research/integer.test.mjs research/live/reference-math.test.mjs research/live/paper-fee-core.test.mjs research/live/paper-share-core.test.mjs
```

TAP: 13 passed, 0 failed, 0 skipped. Integer and reference math each count as one file-level test (17 and 6 internal assertions respectively). Fee core: 4; share core: 7. Prior batches reported 25 passes, making the cumulative reported total 38, not a full suite rerun.

Coverage: Q64 price, gross/net fee, capped dynamic fee, fee conservation, exhausted bin quote, integer principal and checkpoint arithmetic, invalid checkpoint and unsupported extensions; quote depth and discount boundaries; hypothetical fee dilution (100/200 observed versus 90/181 diluted raw units in fixture), changed supply suppresses dilution, invalid scope and limit order state fail closed, calibration diagnostic remains unverified; proportional mapping, wrong side/nonproportional/zero/excessive share rejection, all eight strategy diagnostic rows retained without promoting unavailable strategies, fixed-family mismatch, budget binding and configured share cap, separate fee and PnL readiness.

Remaining: full Engine module regression and Adaptive lifecycle (requires transitive engine dependencies; not executed here), actual paper service end-to-end, local Mac HTTP/SDK/RPC diagnosis, real protocol precision calibration. Fixture outcomes are not real-market evidence or realized PnL. No actual local service, SDK installation, RPC, signing or transactions attempted. Prior archive, HTTP route and local diagnostics tests not rerun.
