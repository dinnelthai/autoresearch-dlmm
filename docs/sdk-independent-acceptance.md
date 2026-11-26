# Independent SDK build and ESM candidate evidence

Status: C02 BLOCKED. Candidate compatibility test passes; original direct ESM still fails. No real RPC or signing.

## Independent reproducibility
Run https://github.com/dinnelthai/autoresearch-dlmm/actions/runs/45871611631, Node 22.23.4, Linux x64, npm 10.9.9, pnpm 10.33.1. Verified upstream commit 1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1 and five pinned blobs. Rebuilt tarball SHA256 7e8da2ee2e528a5aba4c1efd3909dcd74ac94cfed380fa9636f256ade1a41b3b, identical to original Mac artifact. Consumer lock SHA256 dad5c239e5da6b8bb3efe2a59de814a234fd2b1b16fee347f9e96c361b2bd197, matching tarball integrity. npm ci --ignore-scripts installed 159 packages, adapter and CLI smoke 1/1 pass. Pure JS bigint fallback warning remains. No dependency upgrade.

## Candidate progression
- Run 45871904625: replace the single extensionless Anchor bytes import with explicit /index.js. Original ESM SHA256 bba1c677d6c66378f08f9b036b3e66bf42c99ee671bba6248b611299b3371cc0; path candidate d1b524cf5079a4edfdeb2eaf117a401d4f4c776080ee76a6a89c3c5eb405e7b4. Next failure: named export BN not found in Anchor CJS.
- Run https://github.com/dinnelthai/autoresearch-dlmm/actions/runs/45872328290: replace 11 named static Anchor imports with default CJS import and 13 local destructured bindings. Candidate SHA256 e32d73efe8fc2e25da01776f25fd7a980aa2574f54157d82a58fae2cae153b42. Candidate loaded; 15 helper functions, three constants and DLMM.create present. Six signed bin indices and corresponding array boundaries match CJS, with index checked against independent floor(id/70). Candidate step success; original unmodified direct ESM failed, workflow remains red by design.
- The candidate is a temporary installed-file experiment only. It changes generated ESM bytes and is not the locked artifact. No patched tarball, source-map correction, consumer lock migration or deployment approval exists. Do not run a production postinstall patch or treat this as SDK acceptance.
- The next workflow adds exact candidate digest/count guards, a fresh consumer audit and full offline verifier with the unchanged verified SDK. Its results are not yet available.

## Decisions required before formal C02
Prefer an upstream source-level fix and an independently reviewed/rebuilt artifact. Alternatively review a versioned downstream patch with full source diff, regenerated maps, separately recorded tarball and consumer lock integrity; or explicitly approve the CJS adapter as a different runtime contract after security review. Do not silently substitute these options for the agreed direct ESM gate. Existing dependency advisories, reachability, operational compatibility and independent risk-owner approval remain outstanding. No T01–T06 capture before formal C02 acceptance.
