// Node's ESM resolver rejects an extensionless directory import in SDK 1.9.15.
// Load the unmodified upstream CJS distribution until its ESM build is fixed.
import {createRequire} from 'node:module';
const sdk=createRequire(import.meta.url)('@meteora-ag/dlmm');
export default sdk;
export const {createProgram,wrapPosition,getBinArrayIndexesCoverage,deriveBinArray,deriveBinArrayBitmapExtension,getBinArrayLowerUpperBinId,deriveEventAuthority,binIdToBinArrayIndex,toWeightDistribution,toAmountBidSide,toAmountAskSide,toAmountBothSide,positionV2Filter,positionLbPairFilter,positionOwnerFilter,POSITION_MAX_LENGTH,MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,DEFAULT_BIN_PER_POSITION}=sdk;
