// Bitmap enumeration from pinned Meteora SDK helpers/binArray.ts.
function bitmapIndexes(internal,positive,negative){
 const word=(v)=>{const n=BigInt(v.toString());if(n<0n||n>=1n<<64n)throw Error('bitmap word out of u64 range');return n;};
 const scan=(words,n,map)=>{if(!Array.isArray(words)||words.length!==n)throw Error('bitmap layout mismatch');const out=[];for(let i=0;i<n;i++){const w=word(words[i]);for(let b=0;b<64;b++)if((w>>BigInt(b))&1n)out.push(map(i*64+b));}return out;};
 const out=scan(internal,16,b=>b-512);
 if((positive==null)!==(negative==null))throw Error('incomplete extension bitmap');
 if(positive!=null){if(!Array.isArray(positive)||!Array.isArray(negative)||positive.length!==12||negative.length!==12)throw Error('extension bitmap layout mismatch');for(let i=0;i<12;i++){out.push(...scan(positive[i],8,b=>512+i*512+b),...scan(negative[i],8,b=>-513-i*512-b));}}
 return out.sort((a,b)=>a-b);
}
export {bitmapIndexes};
