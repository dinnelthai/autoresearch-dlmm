// V2 trailing bytes are legacy reward/volume fields, not limit orders.
function uint(v,bits){const n=BigInt(v.toString());if(n<0n||n>=(1n<<BigInt(bits)))throw Error('invalid unsigned raw integer');return n.toString()}
function decodeMarketBin(b,binId,version){
 if(version!==2&&version!==3)throw Error('unsupported BinArray version');
 const order=version===3;
 return {binId,amountXRaw:uint(b.amount_x,64),amountYRaw:uint(b.amount_y,64),priceQ64Raw:uint(b.price,128),liquiditySupplyRaw:uint(b.liquidity_supply,128),feeXPerTokenRaw:uint(b.fee_amount_x_per_token_stored,128),feeYPerTokenRaw:uint(b.fee_amount_y_per_token_stored,128),openOrderAmountRaw:order?uint(b.open_order_amount,64):null,totalProcessingOrderAmountRaw:order?uint(b.total_processing_order_amount,64):null,processedOrderRemainingAmountRaw:order?uint(b.processed_order_remaining_amount,64):null};
}
export {decodeMarketBin};
