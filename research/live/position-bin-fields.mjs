// Same common principal / fee fields for legacy V2 and V3. No reward or order interpretation.
const raw=(v,bits)=>{const n=BigInt(v.toString());if(n<0n||n>=1n<<BigInt(bits))throw Error('POSITION_FIELD_OUT_OF_RANGE');return n.toString()};
export function positionBinFields(b,version,binId,share,fee,{allowV2=false}={}){
 if(version!==3&&!(version===2&&allowV2))throw Error('POSITION_BIN_VERSION_UNSUPPORTED');
 if(!Number.isSafeInteger(binId)||!b||!fee)throw Error('POSITION_BIN_INVALID');
 return {binId,supply:raw(b.liquidity_supply,128),share:raw(share,128),amountX:raw(b.amount_x,64),amountY:raw(b.amount_y,64),feeGrowthX:raw(b.fee_amount_x_per_token_stored,128),feeGrowthY:raw(b.fee_amount_y_per_token_stored,128),checkpointX:raw(fee.feeXPerTokenComplete,128),checkpointY:raw(fee.feeYPerTokenComplete,128),pendingX:raw(fee.feeXPending,64),pendingY:raw(fee.feeYPending,64)};
}
