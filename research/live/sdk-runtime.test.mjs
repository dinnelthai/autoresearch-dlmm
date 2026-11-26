import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('installed SDK loads through the project adapter and real CLI starts', async () => {
  const sdk=await import('./sdk-runtime.mjs');
  assert.equal(typeof sdk.default.create,'function');
  for(const k of ['createProgram','wrapPosition','getBinArrayIndexesCoverage','deriveBinArray','deriveBinArrayBitmapExtension','getBinArrayLowerUpperBinId','deriveEventAuthority','binIdToBinArrayIndex','toWeightDistribution','toAmountBidSide','toAmountAskSide','toAmountBothSide','positionV2Filter','positionLbPairFilter','positionOwnerFilter']) assert.equal(typeof sdk[k],'function',k);
  for(const k of ['POSITION_MAX_LENGTH','MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX','DEFAULT_BIN_PER_POSITION']) assert.notEqual(sdk[k],null,k);
  const cli=spawnSync(process.execPath,['research/live/inspect-bins.mjs','--help'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
});
