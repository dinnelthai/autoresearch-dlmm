// Read-only runtime bridge to pinned Meteora helpers. No RPC, no transaction builder.
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {inspectWeightShape} from './weight-shape-core.mjs';
const require=createRequire(import.meta.url);
export async function sdkWeightDiagnostic(d,market,config){
 const blocked=reason=>({status:'BLOCKED',reason,decisionReady:false,executionReady:false,signingAvailable:false});
 if(d?.status==='NO_OPERATION')return {...blocked('NO_LP_BASELINE'),status:'NO_OPERATION'};
 if(d?.status!=='INTEGER_DIAGNOSTIC_ONLY')return blocked('INTEGER_DIAGNOSTIC_UNAVAILABLE');
 if(config?.enabled!==true)return blocked('SDK_WEIGHT_DIAGNOSTIC_DISABLED');
 if(!Number.isInteger(config.maxDeviationBps)||config.maxDeviationBps<0||config.maxDeviationBps>10000)return blocked('WEIGHT_TOLERANCE_REQUIRED');
 try{
  const entry=require.resolve('@meteora-ag/dlmm'),pkg=JSON.parse(await readFile(join(dirname(entry),'..','package.json'),'utf8'));
  if(pkg.name!=='@meteora-ag/dlmm'||pkg.version!=='1.9.15')return blocked('SDK_VERSION_MISMATCH');
  const sdk=await import('@meteora-ag/dlmm'),anchor=await import('@coral-xyz/anchor'),BN=anchor.BN??anchor.default?.BN;
  if(typeof sdk.toWeightDistribution!=='function'||typeof BN!=='function')return blocked('SDK_WEIGHT_HELPER_UNAVAILABLE');
  const positionLimit=Number(sdk.DEFAULT_BIN_PER_POSITION?.toString()),singleMessageExclusiveLimit=sdk.MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX;
  const output=inspectWeightShape(d,market,{maxDeviationBps:config.maxDeviationBps,positionLimit,singleMessageExclusiveLimit,convert:(x,y,rows,step)=>sdk.toWeightDistribution(new BN(x),new BN(y),rows.map(r=>({binId:r.binId,xAmountBpsOfTotal:new BN(r.xBps),yAmountBpsOfTotal:new BN(r.yBps)})),step)});
  return {...output,sdkVersion:pkg.version,sourceReference:'1532e540db41ac405dbf4c5bb2ddfceaa1f98ff1',versionCheck:'INSTALLED_PACKAGE_METADATA_ONLY'};
 }catch{return blocked('SDK_WEIGHT_RUNTIME_UNAVAILABLE')}
}
