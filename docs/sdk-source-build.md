# C02 recovery — pinned Meteora SDK source build

Baseline local report: main 67261ab47c8c77f01e26cc50026fd2cbb3cad969, 131/131 offline verification records passed after decimal grid fix and loopback permission. C02 blocked by npm ETARGET for 1.9.15, not accepted live. Use exact upstream source, not a silent 1.9.14 downgrade.

Verified upstream source at commit 1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1:
- ts-client/package.json blob 6b0040e267f19f7dffa287b6768e5a660f6087cb: package @meteora-ag/dlmm 1.9.15, packageManager pnpm@10.33.1, build tsup, files dist/**.
- ts-client/pnpm-lock.yaml blob 8c589f3f8f595f12ad930a407863b933df7dc6cb.
- ts-client/pnpm-workspace.yaml blob 7177be995327f3f2fc77ca128020a72cb084bbfa: minimumReleaseAge, rpc-websockets@9 override 9.3.8, audit exceptions; review rather than blindly inherit exceptions.
- ts-client/src/dlmm/idl/idl.json blob 6715f5cf19dffa8651a185ac0dd823218c6a2a75.
- ts-client/tsup.config.ts blob ac58e23edc91a079dacc429e8a7b905964029c63: ESM/CJS, declarations, post-build interop; upstream CI uses Node 22.23.4 (record actual verified available version).

## C02.1 — isolated build, no RPC or credentials

From project root, use a fresh disposable source checkout under ignored data/vendor, not existing working tree. Review upstream source, lock, lifecycle scripts and dependency audit first. Use an approved Node 22 LTS environment and exact pnpm version; do not use Node 23 as the acceptance baseline merely because offline tests passed there. Do not publish to npm. No wallet keys or RPC credentials in build environment. If exact version or toolchain cannot be obtained, stop and record reason.

```sh
ROOT="$(pwd)"
mkdir -p "$ROOT/data/vendor"
git clone https://github.com/MeteoraAg/dlmm-sdk.git "$ROOT/data/vendor/dlmm-sdk"
cd "$ROOT/data/vendor/dlmm-sdk"
git checkout --detach 1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1
test "$(git rev-parse HEAD)" = 1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1
test -z "$(git status --porcelain)"
test "$(git hash-object ts-client/package.json)" = 6b0040e267f19f7dffa287b6768e5a660f6087cb
test "$(git hash-object ts-client/pnpm-lock.yaml)" = 8c589f3f8f595f12ad930a407863b933df7dc6cb
test "$(git hash-object ts-client/pnpm-workspace.yaml)" = 7177be995327f3f2fc77ca128020a72cb084bbfa
test "$(git hash-object ts-client/src/dlmm/idl/idl.json)" = 6715f5cf19dffa8651a185ac0dd823218c6a2a75
test "$(git hash-object ts-client/tsup.config.ts)" = ac58e23edc91a079dacc429e8a7b905964029c63
cd ts-client
node --version
pnpm --version
test "$(pnpm --version)" = 10.33.1
```

Run each command only if the previous check succeeded. Review dependency scripts, package integrity and approved build requirements before installing; do not blanket-approve pnpm ignored build scripts. After review:

```sh
pnpm install --frozen-lockfile
pnpm run build
test -f dist/index.mjs
test -f dist/index.js
test -f dist/index.d.ts
git diff --exit-code
npm pack --ignore-scripts --pack-destination "$ROOT/data/vendor"
cd "$ROOT"
shasum -a 256 data/vendor/meteora-ag-dlmm-1.9.15.tgz
```

If any command fails, report the actual error, do not adjust upstream lock or SDK version without separate review. Inspect package contents and metadata. Record build source commit, all above hashes, Node/pnpm versions, build log, tarball SHA256 and npm integrity. A pinned build is auditable; do not claim bit-for-bit reproducibility without an independent rebuild.

## C02.2 — consumer dependency lock

Only after successful reviewed build, edit consumer manifest to use exact local tarball rather than registry version. The main manifest is deliberately unchanged until actual artifact exists. Preserve current exact direct dependency versions. Review consumer dependency resolution separately: upstream pnpm lock does NOT automatically constrain npm consumer transitives, including rpc-websockets. Consider upstream exact override only after checking actual consumer dependency tree and compatibility. Generate lock without install scripts; review integrity, audit and resolutions before npm ci, including any build scripts needed.

```sh
cd "$ROOT/research/live"
npm pkg set 'dependencies.@meteora-ag/dlmm=file:../../data/vendor/meteora-ag-dlmm-1.9.15.tgz'
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
# Review package-lock.json, transitive integrity and audit before actual install.
npm ci
npm ls @meteora-ag/dlmm @coral-xyz/anchor @solana/web3.js @solana/spl-token rpc-websockets
node --input-type=module -e 'import DLMM,* as sdk from "@meteora-ag/dlmm"; for(const k of ["createProgram","wrapPosition","getBinArrayIndexesCoverage","deriveBinArray","deriveBinArrayBitmapExtension","getBinArrayLowerUpperBinId","deriveEventAuthority","binIdToBinArrayIndex","toWeightDistribution","toAmountBidSide","toAmountAskSide","toAmountBothSide"]) if(typeof sdk[k]!=="function") throw Error("missing SDK helper "+k); for(const k of ["POSITION_MAX_LENGTH","MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX","DEFAULT_BIN_PER_POSITION"]) if(sdk[k]==null) throw Error("missing SDK constant "+k); if(typeof DLMM?.create!=="function") throw Error("missing DLMM.create"); console.log("SDK exports present; not protocol acceptance")'
cd "$ROOT"
shasum -a 256 research/live/package-lock.json
node research/live/verify-offline.mjs
```

Review actual package.json name/version via installed package file and verify lockfile integrity against the archived tarball. Store tarball in approved immutable artifact storage or reproduce from pinned source and verify hash; data/vendor is intentionally ignored. Commit reviewed consumer manifest/lock and non-secret provenance only after successful local validation, not the raw build tree. No package install or build performed in chat. This route is a candidate resolution, not C02 PASS.

## Next gate
After C02 PASS, re-capture fresh finalized pool and verify genesis independently (same provider genesis query alone insufficient); bind network provenance, then independently decode pool, mint/vault/bitmap/bin arrays. Existing slot 474048884 capture is historical unverified evidence only. Follow T01–T06 and do not advance decisions from an old snapshot. No changes to signing, simulation scope, or readiness.
