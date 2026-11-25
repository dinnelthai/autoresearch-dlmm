import {IntegerKernel as K} from './integer.mjs';
import {normalizePosition} from './position-input.mjs';
import {Engine} from './engine.mjs';
const Q=K.Q;
const snapshot={sdkCommit:K.SDK_COMMIT,pool:"DEMO_POOL",position:"SYNTH_POSITION",slot:1,asOf:0,tokenOrientation:"MEME_X_SOL_Y",tokenExtensions:false,decimalsX:5,decimalsY:9,binStep:"100",bins:[{binId:1,supply:(10n*Q).toString(),share:(2n*Q).toString(),amountX:"500000000",amountY:"1000000000",feeGrowthX:Q.toString(),feeGrowthY:Q.toString(),checkpointX:"0",checkpointY:"0",pendingX:"0",pendingY:"0"}],expected:{principalX:"100000000",principalY:"200000000",feeX:"2",feeY:"2"}};
const request={entry:"position",pool:"DEMO_POOL",meme:0,sol:5,initialPrice:.0001};
const events=Engine.demo("range").map(e=>({...e,t:e.t+1,...(e.references?{references:e.references.map(r=>({...r,availableAt:r.availableAt+1}))}:{})}));
let n=0;function check(v,m){if(!v)throw Error(m);n++}
const b=normalizePosition(snapshot,request,events,{executionDelaySeconds:0});
check(b.request.positionBins[0].x===1000&&b.request.positionBins[0].y===.2,"raw -> human principal");
check(b.request.pendingFeeX===.00002&&b.request.pendingFeeY===.000000002,"raw -> pending fee");
check(b.config.anchorPrice===.0001&&b.config.binStepBps===100,"absolute bin grid");
const out=Engine.run(b.request,events,b.config,"manual",[{t:1,action:{type:"REMOVE_AND_HOLD"}}]);check(out.state.bins.length===0&&Math.abs(out.report.residual)<1e-8,"business existing position accounting");
check(b.evidence.status==="MATCHES_SUPPLIED_EXPECTED"&&out.protocolExact===false,"fidelity preserved");
for(const [s,r,e,c] of [[{...snapshot,asOf:1},request,events,{}],[{...snapshot,expected:{...snapshot.expected,feeX:"3"}},request,events,{}],[snapshot,{...request,positionBins:[]},events,{}],[snapshot,request,events,{anchorPrice:.1}],[{...snapshot,tokenExtensions:true},request,events,{}]]){let rejected=false;try{normalizePosition(s,r,e,c)}catch{rejected=true}check(rejected,"bad snapshot bridge input")}
console.log("Position bridge assertions:",n);
