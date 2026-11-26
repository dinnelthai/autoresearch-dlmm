import test from 'node:test';import assert from 'node:assert/strict';
import {positionBinFields} from './position-bin-fields.mjs';
import {IntegerKernel as K} from '../integer.mjs';
const Q=1n<<64n;
const b={liquidity_supply:4n*Q,amount_x:100n,amount_y:200n,fee_amount_x_per_token_stored:3n*Q,fee_amount_y_per_token_stored:5n*Q};
const fee={feeXPerTokenComplete:Q,feeYPerTokenComplete:2n*Q,feeXPending:7n,feeYPending:11n};
test('V2 observation uses only common fields, exact same principal/fee rounding as V3',()=>{const a=positionBinFields({...b,open_order_amount:999n},2,-1,Q,fee,{allowV2:true});assert.deepEqual(a,positionBinFields(b,3,-1,Q,fee));assert.deepEqual(K.positionBin(a),{binId:-1,principalX:25n,principalY:50n,feeX:9n,feeY:14n})});
test('V2 requires explicit observation option, unknown versions and invalid amounts fail',()=>{assert.throws(()=>positionBinFields(b,2,0,Q,fee));assert.throws(()=>positionBinFields(b,1,0,Q,fee,{allowV2:true}));assert.throws(()=>positionBinFields({...b,amount_x:1n<<64n},2,0,Q,fee,{allowV2:true}));assert.throws(()=>K.positionBin(positionBinFields(b,2,0,5n*Q,fee,{allowV2:true})))});
