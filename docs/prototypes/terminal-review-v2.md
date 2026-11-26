# T12 terminal — four-pass source review (V1 → V2)

Scope: existing standalone HTML source and T09 JSON contract; no rendered browser audit. Browser control/screenshot unavailable in this chat. V0/V1 and official UI remain unchanged. V2 is independent at terminal-v2.html.

## Pass 1: workflow / information architecture
- P0: report lacks request fingerprint; never present archive as generated for current budget. V2 explicit unbound status and disabled execution. Formal backend must bind canonical raw-unit request hash, pool/mints, capture hash/slot, policy version, timestamps and selection ID; invalidate upon input or snapshot change.
- P1: export/import is engineering workflow, not product interaction. Formal UX: select pool -> load state -> allocate funds/risk -> generate -> review -> explicit confirmation. Keep archive import/export under advanced diagnostics only.
- P1: expose basic budget/risk first; advanced model/cost inputs collapsed and opened on invalid field. Production cost/fee fields derived from verified evidence, user confirms risk budget. No silent invented defaults.
- P1: distinct model result, viewed candidate and final user confirmation. V2 shows archive result and viewed row separately, no confirmation.
 
## Pass 2: efficiency and visual hierarchy
- P1: original chart separately normalized SOL/MEME and compressed nonadjacent bins. V2 uses archive reference SOL valuation with one scale, true bin spacing and active-bin marker; raw quantities remain in table. Not current executable depth.
- P1: show deployment estimate, stress and CVaR in preview; remaining assets/cost require request binding. No LP explicit.
- P2: prioritize form and actionable next step above archive diagnostics on small screens; verify DOM/focus order, sticky primary action, widths and no clipped table in browser. Not implemented as formal UI.
 
## Pass 3: risk/data semantics
- P0: wrong pool, blocked preview with allocations, nested execution readiness, duplicate strategy families and inconsistent selected candidate can mislead. V2 rejects these, validates bin totals/range/unique IDs and No LP allocation. Archive still not chain-authenticated.
- P0: no live price, no executable quote or wallet balance. Show unknown; never zero-fill. Retain all no-LP and blocker reasons. Production should surface stale timestamp, distinct fee income vs projected PnL, independent reference quality and exact SDK execution feasibility.
- P1: validate draft reserve plus one modeled operation cost, nonzero MEME for holding entry; keep human amounts as strings. Actual mint decimal/raw-unit and wallet verification remain mandatory.
 
## Pass 4: exceptional states
- V2: explicit clear archive, stale async import protection retained, hidden advanced section expands on native validation error, selected report requires same target and exact family-best match.
- Browser test cases: no pool, malformed address, wrong pool, changed pool during import, clear archive, corrupted/large JSON, blocked report, No LP, invalid budgets and hidden fields, change draft after import, keyboard/focus, mobile 390px and desktop 1440px. Confirm disabled execution always.
- Static checks: JS parse and literal DOM ID references passed (46 IDs). Isolated source validator: 8/8 checks (valid read-only fixture, wrong pool, outer and inner execution readiness, duplicate family, inconsistent allocation, selected mismatch, blocked parent). Fixture is test-only. No real browser interaction, screenshot, production integration or live acceptance.
 
## Next
UX review with actual browser screenshots, then T12 formal implementation. Avoid adding pool discovery, auto-execution, new DEX or other scope.
