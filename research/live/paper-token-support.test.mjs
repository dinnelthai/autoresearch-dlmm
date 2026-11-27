import test from 'node:test';
import assert from 'node:assert/strict';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType} from '@solana/spl-token';
import {paperTokenSupported} from './inspect-pool.mjs';
import {holderIndexFilters} from './capture-holder-features.mjs';

test('paper accepts metadata-only Token-2022 and rejects economic extensions',()=>{
 const side={tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),mintExtensions:[ExtensionType.MetadataPointer,ExtensionType.TokenMetadata],vaultExtensions:[],vaultFrozen:false};
 assert.equal(paperTokenSupported(side),true);
 assert.equal(paperTokenSupported({...side,mintExtensions:[ExtensionType.TransferFeeConfig]}),false);
 assert.equal(paperTokenSupported({...side,vaultExtensions:[ExtensionType.TransferFeeAmount]}),false);
 assert.equal(paperTokenSupported({...side,vaultFrozen:true}),false);
 assert.equal(paperTokenSupported({...side,tokenProgram:TOKEN_PROGRAM_ID.toBase58(),mintExtensions:[]}),true);
});
test('Token-2022 holder scan does not exclude extended token accounts',()=>{
 const mint='So11111111111111111111111111111111111111112';
 assert.equal(holderIndexFilters(TOKEN_PROGRAM_ID,mint).some(x=>x.dataSize===165),true);
 assert.equal(holderIndexFilters(TOKEN_2022_PROGRAM_ID,mint).some(x=>x.dataSize),false);
});
