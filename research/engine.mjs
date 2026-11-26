/* Offline normalized-event research engine. No RPC, wallet, or protocol-exact claim. */
function createResearchEngine() {
  const EPS=1e-9, clone=o=>JSON.parse(JSON.stringify(o)), sum=a=>a.reduce((s,v)=>s+v,0), clip=(x,l,h)=>Math.min(h,Math.max(l,x));
  const DEFAULTS=Object.freeze({binStepBps:100,anchorPrice:0.0001,maxInventoryRatio:.65,maxInventoryTokens:200000,minSolReserve:1,maxLossSol:6,stressDrop:.6,maxBinShare:.1,lambda:.5,kappaSol:.2,targetRatio:.45,beta:.95,minImprovementSol:.005,uncertaintySol:.005,operationCostSol:.002,cooldownSeconds:120,executionDelaySeconds:10,maxRebalances:8,maxTurnoverSol:30,maxReferenceAge:120,maxReferenceDivergence:.05,minDepthSol:2,maxHolderShare:.55,minFlowSol:1,markoutSeconds:30,forecastSteps:8,forecastHorizonSeconds:480,feeBps:30,protocolShare:.05,slippageBps:50,referencePrice:0.0001});
  const assert=(b,m)=>{if(!b)throw Error(m)};
  const finite=(v,n,min=0,max=Infinity)=>{assert(typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max,n+" invalid");return v};
  function config(overrides={}) {
    for(const k of Object.keys(overrides))assert(k in DEFAULTS,"Unknown parameter "+k);
    const c={...DEFAULTS,...overrides};
    for(const [k,v] of Object.entries(c))finite(v,k);
    for(const k of ["maxInventoryRatio","stressDrop","maxBinShare","targetRatio","beta","maxReferenceDivergence","maxHolderShare","protocolShare"])finite(c[k],k,0,1);
    assert(c.beta<1&&c.maxBinShare>0&&c.binStepBps>0&&c.anchorPrice>0&&c.referencePrice>0&&c.feeBps<10000&&c.slippageBps<10000&&c.forecastSteps>=2&&Number.isInteger(c.forecastSteps)&&c.forecastSteps<=100&&c.forecastHorizonSeconds>0&&Number.isInteger(c.maxRebalances),"invalid config domain");
    return c;
  }
  function price(c,id){assert(Number.isInteger(id),"bin id must be integer");let p=c.anchorPrice*Math.pow(1+c.binStepBps/10000,id);return finite(p,"bin price",Number.MIN_VALUE);}
  function binId(c,p){return Math.round(Math.log(finite(p,"price",Number.MIN_VALUE)/c.anchorPrice)/Math.log(1+c.binStepBps/10000))}
  function cvar(losses,beta){assert(losses.length>0,"empty loss sample");finite(beta,"beta",0,1);assert(beta<1&&losses.every(v=>Number.isFinite(v)&&v>=0),"invalid loss sample");const a=losses.slice().sort((x,y)=>y-x),mass=a.length*(1-beta);let s=0;for(let i=0;i<a.length&&i<mass;i++)s+=a[i]*Math.min(1,mass-i);return s/mass}
  function balances(s){return {x:s.wallet.x+s.pendingFees.x+sum(s.bins.map(b=>b.x)),y:s.wallet.y+s.pendingFees.y+sum(s.bins.map(b=>b.y))}}
  function nav(s,p){const b=balances(s);return b.x*p+b.y}
  function hodl(s,p){return s.baseline.x*p+s.baseline.y}
  function reportAt(s,p){
    const b=balances(s),v=nav(s,p),grossFee=s.feesEarned.x*p+s.feesEarned.y,reward=s.rewardsEarned.x*p+s.rewardsEarned.y,inventory=sum(s.fills.map(f=>f.q*(p-f.price))),fair=sum(s.fills.filter(f=>f.reference!==null).map(f=>f.q*(p-f.reference))),adverse=sum(s.fills.filter(f=>f.reference!==null).map(f=>f.q*(f.price-f.reference))),unattributed=sum(s.fills.filter(f=>f.reference===null).map(f=>f.q*(p-f.price))),alpha=v-hodl(s,p);
    const pnl=v-s.initialNav-s.externalFlows;
    return {nav:v,pnl,alpha,hodl:hodl(s,p),solBenchmark:s.initialNav+s.externalFlows,alphaSol:pnl,fee:grossFee,reward,feeX:s.feesEarned.x,feeY:s.feesEarned.y,inventory,fair,adverse,unattributed,cost:s.cost,externalFlows:s.externalFlows,reference:p,inventoryX:b.x,inventoryY:b.y,ratio:v>EPS?b.x*p/v:0,residual:alpha-(inventory+grossFee+reward-s.cost),unclaimed:clone(s.pendingFees),claimed:clone(s.claimed),markout:markoutSummary(s),turnover:s.turnover,rebalanceTurnover:s.rebalanceTurnover,rebalances:s.rebalances};
  }
  function newState(request,c){
    assert(["holding","sol","position"].includes(request.entry),"invalid entry");
    const x=finite(request.meme,"meme"),y=finite(request.sol,"sol"),p=finite(request.initialPrice,"initialPrice",Number.MIN_VALUE);
    assert(request.entry!=="sol"||x===0,"SOL entry must have no MEME");
    assert(request.entry!=="position"||Array.isArray(request.positionBins)&&request.positionBins.length>0,"position entry requires normalized position bins");
    const bins=(request.positionBins||[]).map(b=>({id:b.id,x:finite(b.x,"bin x"),y:finite(b.y,"bin y"),liquidity:finite(b.x,"bin x")*price(c,b.id)+finite(b.y,"bin y")}));
    assert(request.entry==="position"||bins.length===0,"unexpected position bins");
    assert(new Set(bins.map(b=>b.id)).size===bins.length,"duplicate initial bin");
    const pendingFees={x:finite(request.pendingFeeX??0,"pendingFeeX"),y:finite(request.pendingFeeY??0,"pendingFeeY")};
    assert(request.entry==="position"||pendingFees.x+pendingFees.y===0,"pending fees require position");
    const s={wallet:{x,y},bins,pendingFees,feesEarned:{x:0,y:0},rewardsEarned:{x:0,y:0},poolBins:{},claimed:{x:0,y:0},fills:[],marks:[],market:null,history:[],baseline:{x:0,y:0},initialNav:0,externalFlows:0,cost:0,turnover:0,rebalances:0,receipts:[],pending:null,lastActionTime:-1e12,curve:[],seen:[],lastTime:-1,quality:[],status:bins.length?"OPEN":"FLAT",decisions:[],allowDispose:request.allowDispose===true,pool:request.pool??null,goal:request.goal??"balanced",riskLog:[],rebalanceTurnover:0};
    s.baseline=balances(s);s.initialNav=nav(s,p);assert(s.initialNav>0,"initial capital must be positive");return s;
  }
  function reference(e,c){
    if(!Array.isArray(e.references))return {valid:false,reason:"MISSING_REFERENCES"};
    const rs=e.references.filter(r=>r.pool!==e.pool&&typeof r.pool==="string"&&typeof r.price==="number"&&r.price>0&&Number.isFinite(r.price)&&typeof r.depth==="number"&&Number.isFinite(r.depth)&&r.depth>=c.minDepthSol&&Number.isFinite(r.availableAt)&&r.availableAt<=e.t&&r.availableAt>=e.t-c.maxReferenceAge&&Number.isFinite(r.observedAt??r.availableAt)&&(r.observedAt??r.availableAt)<=r.availableAt&&(r.observedAt??r.availableAt)>=e.t-c.maxReferenceAge);
    const uniq=[...new Map(rs.slice().sort((a,b)=>a.availableAt-b.availableAt).map(r=>[r.pool,r])).values()];
    if(uniq.length<2)return {valid:false,reason:"INSUFFICIENT_INDEPENDENT_POOLS"};
    const ps=uniq.map(r=>r.price),depth=sum(uniq.map(r=>r.depth));
    if(!Number.isFinite(depth)||depth<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
    const p=sum(uniq.map(r=>r.price*(r.depth/depth)));
    if(!Number.isFinite(p)||p<=0)return {valid:false,reason:'REFERENCE_NUMERIC_DOMAIN'};
    if((Math.max(...ps)-Math.min(...ps))/p>c.maxReferenceDivergence)return {valid:false,reason:"REFERENCE_DIVERGENCE"};
    return {valid:true,price:p,depth,pools:uniq.map(r=>r.pool),expiresAt:Math.min(...uniq.map(r=>(r.observedAt??r.availableAt)+c.maxReferenceAge))};
  }
  function fresh(s,c,t=s.lastTime){return !!s.market?.ref.valid&&t>=s.market.t&&t<=s.market.ref.expiresAt&&t-s.market.t<=c.maxReferenceAge;}
  function classify(s,c){
    const m=s.market;if(!m||!fresh(s,c))return {regime:"UNKNOWN",flags:["REFERENCE_UNAVAILABLE"],features:{}};
    const flags=[];
    if(m.tokenSafe!==true)flags.push("TOKEN_RISK");
    if(!Number.isFinite(m.holderShare))flags.push("HOLDER_UNKNOWN");else if(m.holderShare>c.maxHolderShare)flags.push("HOLDER_CONCENTRATION");
    if(!Number.isFinite(m.exitDepth)||m.exitDepth<c.minDepthSol)flags.push("EXIT_DEPTH_LOW");
    if(!Number.isFinite(m.flowSol)||m.flowSol<c.minFlowSol)flags.push("FLOW_LOW");
    if(!Number.isFinite(m.holderOutflow)||!Number.isFinite(m.buyImbalance))flags.push("FLOW_UNKNOWN");
    const ps=s.history.slice(-12).map(x=>x.ref.price);
    const returns=ps.slice(1).map((p,i)=>Math.log(p/ps[i])),trend=returns.length?sum(returns):0,volatility=Math.sqrt(sum(returns.map(r=>r*r))),path=sum(returns.map(Math.abs)),efficiency=path>EPS?Math.abs(trend)/path:0;
    const mature=markoutSummary(s);
    if(mature.bid.count>=3&&mature.bid.bps<-100)flags.push("TOXIC_BID");
    if(mature.ask.count>=3&&mature.ask.bps<-100)flags.push("TOXIC_ASK");
    let regime="HEALTHY_RANGE";
    if(flags.includes("TOKEN_RISK")||flags.includes("EXIT_DEPTH_LOW")||returns.some(r=>r<-.20))regime="STRESS";
    else if(flags.includes("HOLDER_UNKNOWN")||flags.includes("FLOW_UNKNOWN")||ps.length<3)regime="UNKNOWN";
    else if(m.holderOutflow>.1&&m.buyImbalance<0)regime="DISTRIBUTION_RANGE";
    else if(flags.includes("FLOW_LOW"))regime="DEAD_RANGE";
    else if(efficiency>.65&&trend>.025)regime="UPTREND";
    else if(efficiency>.65&&trend<-.025)regime="DOWNTREND";
    return {regime,flags,features:{trend,volatility,efficiency,buyImbalance:m.buyImbalance,holderOutflow:m.holderOutflow,markout:mature},calibration:"UNCALIBRATED_RULES"};
  }
  function markoutSummary(s){
    const out={};
    for(const side of ["bid","ask"]){const rows=s.marks.filter(m=>m.side===side),n=sum(rows.map(m=>m.notional));out[side]={count:rows.length,bps:n>EPS?10000*sum(rows.map(m=>m.net))/n:null,net:sum(rows.map(m=>m.net))}}
    out.eligible=s.fills.filter(f=>f.kind==="LP").length;out.coverage=out.eligible?(out.bid.count+out.ask.count)/out.eligible:null;return out;
  }
  function mature(s,c,m){
    if(!m.ref.valid)return;
    for(const f of s.fills){if(f.kind!=="LP"||f.marked||f.reference===null||m.t<f.t+c.markoutSeconds)continue;
      // First available valid observation after target horizon; bound staleness, never interpolate.
      f.marked=true;if(m.t-f.t-c.markoutSeconds>c.maxReferenceAge)continue;
      s.marks.push({t:m.t,fillId:f.id,side:f.q>0?"bid":"ask",notional:Math.abs(f.q)*f.price,net:f.q*(m.ref.price-f.price)+f.feeX*m.ref.price+f.feeY});
    }
  }
  function risk(s,c,p){
    const b=balances(s),v=nav(s,p),bid=sum(s.bins.map(i=>i.y)),postX=b.x+sum(s.bins.map(i=>i.y/price(c,i.id))),postY=b.y-bid,stressP=p*(1-c.stressDrop);
    const stressedValue=b.x*stressP+b.y-sum(s.bins.map(i=>i.y*Math.max(0,1-stressP/price(c,i.id))));
    const loss=Math.max(0,v-stressedValue,s.initialNav+s.externalFlows-stressedValue);
    const worstRatio=postX*p+postY>EPS?postX*p/(postX*p+postY):0;
    const violations=[];
    if(s.market?.ref.valid&&(!Number.isFinite(s.market.exitDepth)||postX*p>s.market.exitDepth+EPS))violations.push("EXIT_CAPACITY");
    if(s.wallet.y<c.minSolReserve-EPS)violations.push("SOL_RESERVE");
    if(postX>c.maxInventoryTokens+EPS)violations.push("INVENTORY_QUANTITY");
    if(worstRatio>c.maxInventoryRatio+EPS)violations.push("INVENTORY_RATIO");
    if(loss>c.maxLossSol+EPS)violations.push("STRESS_LOSS");
    return {bid,postX,postY,worstRatio,stressLoss:loss,stressedValue,violations};
  }
  function bidCap(s,c,p){
    const b=balances(s),v=nav(s,p),z=v>EPS?b.x*p/v:1,existing=sum(s.bins.map(b=>b.y));
    return Math.max(0,Math.min(s.wallet.y-c.minSolReserve,(c.maxInventoryRatio-z)*v-existing));
  }
  function pay(s,cost){finite(cost,"cost");assert(s.wallet.y+EPS>=cost,"insufficient SOL for cost");s.wallet.y=Math.max(0,s.wallet.y-cost);s.cost+=cost}
  function release(s,fraction=1){finite(fraction,"fraction",0,1);for(const b of s.bins){s.wallet.x+=b.x*fraction;s.wallet.y+=b.y*fraction;b.x*=1-fraction;b.y*=1-fraction;b.liquidity*=1-fraction}s.bins=s.bins.filter(b=>b.liquidity>EPS);s.status=s.bins.length?"OPEN":"FLAT";}
  function claim(s){s.wallet.x+=s.pendingFees.x;s.wallet.y+=s.pendingFees.y;s.claimed.x+=s.pendingFees.x;s.claimed.y+=s.pendingFees.y;s.pendingFees={x:0,y:0}}
  function spot(s,c,p,q,m,t){
    // Synthetic executable-depth proxy. Costs embedded in execution price, not debited twice.
    if(!m?.ref.valid||!Number.isFinite(m.exitDepth)||m.exitDepth<=0)return 0;
    let amount=Math.min(Math.abs(q),m.exitDepth/p);
    const sign=Math.sign(q),e=p*(1+sign*c.slippageBps/10000);
    amount=Math.min(amount,sign>0?s.wallet.y/e:s.wallet.x);
    if(amount<EPS)return 0;
    const d=sign*amount;s.wallet.x+=d;s.wallet.y-=d*e;s.turnover+=amount*e;
    s.fills.push({id:"spot:"+s.fills.length,t,kind:"SPOT",q:d,price:e,reference:p,feeX:0,feeY:0});return d;
  }
  function weights(n,shape,alpha,skew=0){
    assert(["spot","curve","bid_ask","hybrid"].includes(shape),"unknown shape");finite(alpha,"hybrid alpha",0,1);assert(Number.isFinite(skew),"invalid skew");
    const edge=Array.from({length:n},(_,i)=>.1+((i+1)/n)**2),edgeSum=sum(edge),curve=Array.from({length:n},(_,i)=>Math.exp(-3*((i+1)/n)**2));
    const raw=edge.map((v,i)=>(shape==="spot"?1/n:shape==="curve"?curve[i]:shape==="bid_ask"?v/edgeSum:alpha/n+(1-alpha)*v/edgeSum)*Math.exp(skew*(i+1)/n));
    const total=sum(raw);return raw.map(x=>x/total);
  }
  function planBins(c,p,bid,ask,spec){
    const mid=binId(c,p),n=spec.width;
    const wb=weights(n,spec.shape,spec.alphaBid??.5,spec.skewBid??0),wa=weights(n,spec.shape,spec.alphaAsk??.5,spec.skewAsk??0);
    const active=spec.active??0;
    const map=new Map();
    function add(id,x,y){const b=map.get(id)||{id,x:0,y:0,liquidity:0};b.x+=x;b.y+=y;b.liquidity=b.x*price(c,id)+b.y;map.set(id,b)}
    const ax=wa.map((w,i)=>w/price(c,mid+1+i)),axs=sum(ax);
    for(let i=0;i<n;i++){add(mid-1-i,0,bid*(1-active)*wb[i]);add(mid+1+i,ask*(1-active)*ax[i]/axs,0)}
    add(mid,ask*active,bid*active);return [...map.values()].filter(b=>b.liquidity>EPS).sort((a,b)=>a.id-b.id);
  }
  function deploy(s,c,p,spec){
    const cap=bidCap(s,c,p),bid=Math.min(spec.bidFraction*cap,Math.max(0,s.wallet.y-c.minSolReserve)),ask=s.wallet.x*spec.askFraction;
    const bins=planBins(c,p,bid,ask,spec);s.wallet.y-=sum(bins.map(b=>b.y));s.wallet.x-=sum(bins.map(b=>b.x));
    for(const b of bins){const old=s.bins.find(a=>a.id===b.id);if(old){old.x+=b.x;old.y+=b.y;old.liquidity+=b.liquidity}else s.bins.push(b)}
    s.status=s.bins.length?"OPEN":"FLAT";return {bid,ask};
  }
  function applyAction(s,c,action,t,opts={}){
    const p=fresh(s,c,t)?s.market.ref.price:null;
    const k=action.type;
    assert(!['DISPOSE','REMOVE_AND_DISPOSE'].includes(k)||s.allowDispose===true,'DISPOSAL_NOT_ALLOWED');
    if(["HOLD","NO_LP"].includes(k))return {status:"NO_ACTION"};
    if(k==="FUND"||k==="WITHDRAW"){assert(p!==null,"reference required for external flows");const x=finite(action.x??0,"flow x"),y=finite(action.y??0,"flow y"),sign=k==="FUND"?1:-1;if(sign<0)assert(x<=Math.min(s.wallet.x,s.baseline.x)+EPS&&y<=Math.min(s.wallet.y,s.baseline.y)+EPS,"withdraw exceeds wallet or matched HODL inventory");s.wallet.x+=sign*x;s.wallet.y+=sign*y;s.baseline.x+=sign*x;s.baseline.y+=sign*y;s.externalFlows+=sign*(x*p+y);return {status:"CONFIRMED"}}
    assert(p!==null||["CLAIM","REMOVE","REMOVE_AND_HOLD","REDUCE"].includes(k),"reference required for "+k);
    pay(s,c.operationCostSol);
    if(opts.fail)return {status:"FAILED",reason:"SYNTHETIC_FAILURE"};
    if(k==="CLAIM"){claim(s);return {status:"CONFIRMED"}}
    if(k==="DISPOSE"){const wanted=Math.min(finite(action.quantity??s.wallet.x,"dispose quantity"),s.wallet.x),sold=-spot(s,c,p,-wanted,s.market,t);return {status:sold+EPS<wanted?"PARTIAL":"CONFIRMED",sold,remainingInventory:s.wallet.x}}
    if(k==="REDUCE"||k==="REMOVE"||k==="REMOVE_AND_HOLD"||k==="REMOVE_AND_DISPOSE"){
      const fraction=k==="REDUCE"?finite(action.fraction??.5,"reduce fraction",0,1):1;
      release(s,fraction*(opts.partial?.5:1));if(k.startsWith("REMOVE"))claim(s);
      let remaining=s.wallet.x,sold=0;
      if(k==="REMOVE_AND_DISPOSE"&&!opts.partial){const wanted=s.wallet.x;sold=-spot(s,c,p,-wanted,s.market,t);remaining=s.wallet.x}
      return {status:opts.partial||(k==="REMOVE_AND_DISPOSE"&&remaining>EPS)?"PARTIAL":"CONFIRMED",remainingInventory:remaining,sold,phases:k==="REMOVE_AND_DISPOSE"?["REMOVE",opts.partial?"DISPOSE_NOT_ATTEMPTED":"DISPOSE"]:["REMOVE"]};
    }
    assert(["OPEN","ADD","REPOSITION"].includes(k),"unsupported action "+k);
    if(k==="OPEN")assert(s.bins.length===0,"OPEN requires flat position");
    if(k==="REPOSITION"){s.rebalanceTurnover+=sum(s.bins.map(b=>b.x*p+b.y));release(s);claim(s);s.rebalances++;if(opts.partial)return {status:"PARTIAL",reason:"REMOVED_NOT_REDEPLOYED"}}
    if(action.acquireSol){const budget=Math.min(finite(action.acquireSol,"acquireSol"),Math.max(0,s.wallet.y-c.minSolReserve));spot(s,c,p,budget/(p*(1+c.slippageBps/10000)),s.market,t)}
    const spec=action.spec?{...action.spec}:null;assert(spec&&Number.isInteger(spec.width)&&spec.width>0&&spec.width<=50,"invalid plan");
    for(const key of ["bidFraction","askFraction"])finite(spec[key],key,0,1);
    for(const key of ["active","alphaBid","alphaAsk"])if(spec[key]!=null)finite(spec[key],key,0,1);
    if(opts.partial){spec.bidFraction*=.5;spec.askFraction*=.5;}const d=deploy(s,c,p,spec);if(k==="REPOSITION")s.rebalanceTurnover+=d.bid+d.ask*p;return {status:opts.partial?"PARTIAL":"CONFIRMED",...d};
  }
  function swap(s,c,e){
    const p=price(c,e.bin),q=finite(e.baseQty,"swap baseQty"),ext=finite(e.externalLiquiditySol??s.poolBins[e.bin],"external liquidity",EPS),fx=finite(e.mmFeeX,"MM fee X"),fy=finite(e.mmFeeY,"MM fee Y");assert(["LP_BUY","LP_SELL"].includes(e.side),"invalid swap direction");
    const b=s.bins.find(b=>b.id===e.bin);if(!b||b.liquidity<EPS||q===0)return;
    const share=b.liquidity/(ext+b.liquidity);
    if(share>c.maxBinShare+EPS){s.quality.push({id:e.id,reason:"FROZEN_PATH_SHARE_LIMIT",share});return;}
    const requested=q*share,amount=Math.min(requested,e.side==="LP_BUY"?b.y/p:b.x);
    if(amount<EPS)return;
    const d=e.side==="LP_BUY"?amount:-amount,ratio=amount/q,feeX=fx*ratio,feeY=fy*ratio;
    b.x=Math.max(0,b.x+d);b.y=Math.max(0,b.y-d*p);s.pendingFees.x+=feeX;s.pendingFees.y+=feeY;s.feesEarned.x+=feeX;s.feesEarned.y+=feeY;
    const ref=fresh(s,c,e.t)?s.market.ref.price:null;
    s.fills.push({id:e.id,t:e.t,kind:"LP",bin:e.bin,q:d,price:p,reference:ref,feeX,feeY,share});
  }
  function record(s,p,t){
    const v=nav(s,p),adjusted=v-s.externalFlows,peak=Math.max(s.initialNav,...s.curve.map(x=>x.adjusted),adjusted);
    s.curve.push({t,nav:v,adjusted,drawdown:peak>EPS?(peak-adjusted)/peak:0,...balances(s)});
  }
  function event(s,c,e){
    assert(typeof e.id==="string"&&e.id.length,"event id required");finite(e.t,"event time");assert(e.t>=s.lastTime,"out of order event");assert(!s.seen.includes(e.id),"duplicate event");s.seen.push(e.id);s.lastTime=e.t;
    if(e.type==="MARKET"){assert(typeof e.pool==="string"&&e.pool.length>0,"market pool required");assert(!s.pool||s.pool===e.pool,"market pool mismatch");if(!s.pool)s.pool=e.pool;const ref=reference(e,c);s.market={...e,ref};if(ref.valid){s.history.push(s.market);mature(s,c,s.market)}else s.quality.push({id:e.id,reason:ref.reason})}
    else if(e.type==="SWAP"){assert(!e.pool||e.pool===s.pool,"swap pool mismatch");swap(s,c,e);}
    else if(e.type==="POOL_STATE"){assert(Array.isArray(e.bins),"pool snapshot bins required");s.poolBins={};for(const b of e.bins){assert(Number.isInteger(b.id)&&!(b.id in s.poolBins),"invalid snapshot bin");s.poolBins[b.id]=finite(b.externalLiquiditySol,"external liquidity",EPS);}}
    else if(e.type==="LIQUIDITY_UPDATE"){assert(Number.isInteger(e.bin),"invalid update bin");s.poolBins[e.bin]=finite(e.externalLiquiditySol,"external liquidity",EPS);}
    else if(e.type==="REWARD"){const x=finite(e.x??0,"reward x"),y=finite(e.y??0,"reward y");if(s.bins.length){s.pendingFees.x+=x;s.pendingFees.y+=y;s.rewardsEarned.x+=x;s.rewardsEarned.y+=y;}}
    else assert(false,"unknown event type");
    if(fresh(s,c,e.t)){record(s,s.market.ref.price,e.t);const r=risk(s,c,s.market.ref.price);if(r.violations.length)s.riskLog.push({t:e.t,event:e.id,...r});}
  }
  function executePending(s,c,t){
    if(!s.pending)return;
    if(s.pending.expires!==null&&t>s.pending.expires){const op=s.pending;s.pending=null;s.receipts.push({id:op.id,t,action:op.action.type,status:"EXPIRED"});return;}
    if(t<s.pending.due)return;
    const op=s.pending,trial=clone(s);trial.pending=null;
    try{
      const result=applyAction(trial,c,op.action,t,op.options);
      if(["OPEN","ADD","REPOSITION"].includes(op.action.type)&&result.status!=="FAILED"&&result.reason!=="REMOVED_NOT_REDEPLOYED"){
        assert(trial.market?.ref.valid,"invalid execution reference");
        const r=risk(trial,c,trial.market.ref.price),g=classify(trial,c);
        assert(fresh(trial,c,t),"stale execution reference");
        assert(trial.rebalances<=c.maxRebalances&&trial.rebalanceTurnover+trial.turnover<=c.maxTurnoverSol,"turnover budget exceeded");
        assert(!g.flags.includes("TOXIC_BID")||!trial.bins.some(b=>b.y>EPS),"toxic bid blocked");
        assert(!g.flags.includes("TOXIC_ASK")||!trial.bins.some(b=>b.x>EPS),"toxic ask blocked");
        assert(!r.violations.length,"execution risk: "+r.violations.join(","));
        assert(!["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)&&!g.flags.includes("HOLDER_CONCENTRATION"),"market admission changed");
      }
      Object.assign(s,trial);s.lastActionTime=t;s.receipts.push({id:op.id,t,action:op.action.type,...result});
      if(fresh(s,c,t))record(s,s.market.ref.price,t);
    }catch(err){s.pending=null;s.receipts.push({id:op.id,t,action:op.action.type,status:"REJECTED",reason:String(err.message)});}
  }
  function submit(s,c,action,t,options={}){
    assert(!s.pending,"operation already pending");const id="operation:"+s.receipts.length;
    const expires=options.expiresAfterSeconds==null?null:t+finite(options.expiresAfterSeconds,"expiry");s.pending={id,action:clone(action),due:t+c.executionDelaySeconds,expires,options:clone(options)};s.receipts.push({id,t,action:action.type,status:"SUBMITTED"});
    if(c.executionDelaySeconds===0)executePending(s,c,t);
  }
  function forecast(s,c){
    const m=s.market,p=m.ref.price,mid=binId(c,p),step=1+c.binStepBps/10000;
    const g=classify(s,c),r=g.features,amp=clip(Math.round((r.volatility||.02)/Math.log(step)),2,8);
    const drift=g.regime==="UPTREND"?1:g.regime==="DOWNTREND"?-1:0;
    const patterns=[{name:"range",f:i=>Math.round(amp*Math.sin(i*Math.PI/2))},{name:"up",f:i=>i},{name:"down",f:i=>-i},{name:"whipsaw",f:i=>i<c.forecastSteps/2?i:-i},{name:"stress",f:i=>-Math.round(i*amp/2)}];
    return patterns.map((pat,j)=>{
      const events=[];
      for(let i=1;i<=c.forecastSteps;i++){
        const id=mid+pat.f(i)+(j===0?drift*i:0),px=price(c,id),t=s.lastTime+c.forecastHorizonSeconds*i/c.forecastSteps;
        events.push({type:"MARKET",id:"f"+j+"m"+i,t,pool:m.pool,references:[{pool:"scenario-a",price:px,depth:Math.max(10,m.ref.depth/2),availableAt:t},{pool:"scenario-b",price:px,depth:Math.max(10,m.ref.depth/2),availableAt:t}],exitDepth:m.exitDepth,tokenSafe:m.tokenSafe,holderShare:m.holderShare,holderOutflow:m.holderOutflow,buyImbalance:m.buyImbalance,flowSol:m.flowSol});
        const qty=Math.max(0,m.flowSol||0)/px*.25,side=pat.f(i)+(j===0?drift*i:0)>=pat.f(i-1)+(j===0?drift*(i-1):0)?"LP_SELL":"LP_BUY",fee=qty*c.feeBps/10000*(1-c.protocolShare);
        events.push({type:"SWAP",id:"f"+j+"s"+i,t,bin:id,side,baseQty:qty,externalLiquiditySol:Math.max(10,m.ref.depth/2),mmFeeX:side==="LP_BUY"?fee:0,mmFeeY:side==="LP_SELL"?fee*px:0});
      }
      return {name:pat.name,events};
    });
  }
  function evaluate(s,c,action,scenarios){
    let start;
    try{
      assert(fresh(s,c),'REFERENCE_UNAVAILABLE_OR_STALE');
      assert(Array.isArray(scenarios)&&scenarios.length>0&&scenarios.every(v=>Array.isArray(v.events)&&v.events.length>0),'SCENARIO_SAMPLE_EMPTY');
      const p=s.market.ref.price,base=nav(s,p),out=[];
      assert(Number.isFinite(base)&&base>0,'SCENARIO_BASE_INVALID');
      start=clone(s);start.pending=null;const a=applyAction(start,c,action,s.lastTime);const g=classify(start,c),rr=risk(start,c,p);
      if(["OPEN","ADD","REPOSITION"].includes(action.type)){
        if(!start.bins.length)throw Error("EMPTY_DEPLOYMENT");
        if(start.turnover+start.rebalanceTurnover>c.maxTurnoverSol||start.rebalances>c.maxRebalances)throw Error("REBALANCE_BUDGET");
        if(["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)||g.flags.includes("HOLDER_CONCENTRATION"))throw Error("MARKET_ADMISSION");
        if(g.flags.includes("TOXIC_BID")&&sum(start.bins.map(b=>b.y))>EPS)throw Error("TOXIC_BID");
        if(g.flags.includes("TOXIC_ASK")&&sum(start.bins.map(b=>b.x))>EPS)throw Error("TOXIC_ASK");
      }
      if(rr.violations.length)throw Error(rr.violations.join(","));
      for(const scenario of scenarios){
        const sim=clone(s);sim.pending=null;sim.seen=[];sim.lastTime=s.lastTime;sim.quality=[];
        if(!["HOLD","NO_LP"].includes(action.type))submit(sim,c,action,s.lastTime);
        // Observe pre/post-action path, not just the terminal mark. Existing passive
        // exposure remains a comparator even when a hypothetical shock violates limits.
        let minNav=base,peakNav=base,maxDrawdownSol=0,maxInventoryRatio=0,maxInventoryTokens=0,minWalletSol=Infinity,maxStressLossSol=0,minExitHeadroomSol=Infinity,observations=0,unobserved=0;
        const pathViolations=new Set();
        function observe(){
          if(!fresh(sim,c)){unobserved++;return;}
          const px=sim.market.ref.price,v=nav(sim,px),r=risk(sim,c,px),headroom=sim.market.exitDepth-r.postX*px;
          assert([v,r.worstRatio,r.postX,sim.wallet.y,r.stressLoss,headroom].every(Number.isFinite),'SCENARIO_PATH_NONFINITE');
          minNav=Math.min(minNav,v);peakNav=Math.max(peakNav,v);maxDrawdownSol=Math.max(maxDrawdownSol,peakNav-v);
          maxInventoryRatio=Math.max(maxInventoryRatio,r.worstRatio);maxInventoryTokens=Math.max(maxInventoryTokens,r.postX);
          minWalletSol=Math.min(minWalletSol,sim.wallet.y);maxStressLossSol=Math.max(maxStressLossSol,r.stressLoss);minExitHeadroomSol=Math.min(minExitHeadroomSol,headroom);observations++;
          for(const v of r.violations)pathViolations.add(v);
        }
        observe();
        for(const e of scenario.events){event(sim,c,e);observe();executePending(sim,c,e.t);observe();}

        if(sim.pending||sim.receipts.slice(s.receipts.length).some(r=>["REJECTED","FAILED","EXPIRED"].includes(r.status)))throw Error("SCENARIO_EXECUTION_UNAVAILABLE");
        assert(fresh(sim,c),'SCENARIO_END_REFERENCE_UNAVAILABLE');
        assert(!unobserved,'SCENARIO_PATH_REFERENCE_UNAVAILABLE');
        const end=reportAt(sim,sim.market.ref.price),before=reportAt(s,sim.market.ref.price);
        assert([end.nav,end.alpha,end.ratio,end.fee,end.cost,before.alpha,before.fee,before.cost].every(Number.isFinite),'SCENARIO_NONFINITE_OUTPUT');
        if(sim.quality.some(q=>q.reason==="FROZEN_PATH_SHARE_LIMIT"))throw Error("FROZEN_PATH_SHARE_LIMIT");
        out.push({name:scenario.name,incrementalAlpha:end.alpha-before.alpha,pnl:end.nav-base,loss:Math.max(0,base-minNav),terminalLoss:Math.max(0,base-end.nav),ratio:end.ratio,fee:end.fee-before.fee,cost:end.cost-before.cost,pathRisk:{minNav,maxDrawdownSol,maxInventoryRatio,maxInventoryTokens,minWalletSol,maxStressLossSol,minExitHeadroomSol,observations,violations:[...pathViolations]}});
      }
      const mean=fn=>sum(out.map(fn))/out.length,tail=cvar(out.map(a=>a.loss),c.beta),terminalCvar=cvar(out.map(a=>a.terminalLoss),c.beta),utility=mean(a=>a.incrementalAlpha)-c.lambda*tail-c.kappaSol*mean(a=>(a.ratio-c.targetRatio)**2);
      assert(Number.isFinite(utility)&&Number.isFinite(tail),'SCENARIO_NONFINITE_SCORE');
      return {action,feasible:true,utility,expectedPnl:mean(a=>a.pnl),expectedAlpha:mean(a=>a.incrementalAlpha),expectedFee:mean(a=>a.fee),cvar:tail,terminalCvar,pathRisk:{lossBasis:'MAX_LOSS_FROM_INITIAL_NAV_ALONG_SAMPLED_PATH',breachScenarioCount:out.filter(a=>a.pathRisk.violations.length).length,scenarioCount:out.length,maxDrawdownSol:Math.max(...out.map(a=>a.pathRisk.maxDrawdownSol)),maxInventoryRatio:Math.max(...out.map(a=>a.pathRisk.maxInventoryRatio)),maxInventoryTokens:Math.max(...out.map(a=>a.pathRisk.maxInventoryTokens)),minWalletSol:Math.min(...out.map(a=>a.pathRisk.minWalletSol)),maxStressLossSol:Math.max(...out.map(a=>a.pathRisk.maxStressLossSol)),minExitHeadroomSol:Math.min(...out.map(a=>a.pathRisk.minExitHeadroomSol)),violations:[...new Set(out.flatMap(a=>a.pathRisk.violations))]},scenarios:out,allocation:clone(start.bins),allocationLabel:"IMMEDIATE_PLAN_PREVIEW_NOT_EXECUTION",risk:rr};
    }catch(err){return {action,feasible:false,reason:err.message}}
  }
  function candidatePlans(s,c,mode="adaptive"){
    const g=classify(s,c),open=s.bins.length>0,plans=[{type:open?"HOLD":"NO_LP"}];
    if(open)plans.push({type:"REDUCE",fraction:.5},{type:"REMOVE_AND_HOLD"});
    if(s.allowDispose&&balances(s).x>EPS)plans.push({type:"REMOVE_AND_DISPOSE"});
    const shapes=mode==="adaptive"?["spot","curve","bid_ask","hybrid","asymmetric"]:[mode==="asymmetric"?"asymmetric":mode];
    for(const shape of shapes)for(const width of (mode==="adaptive"?[2,4,8]:[4]))for(const size of (mode==="adaptive"?[.5,1]:[1])){
      const isAsym=shape==="asymmetric";
      const spec={shape:isAsym?"hybrid":shape,width,bidFraction:g.regime==="DOWNTREND"||g.flags.includes("TOXIC_BID")?0:size,askFraction:g.flags.includes("TOXIC_ASK")?0:isAsym&&g.regime==="UPTREND"?.25*size:.7*size,active:shape==="curve"?.2:shape==="spot"?.1:0,alphaBid:isAsym?.75:.5,alphaAsk:isAsym?.25:.5,skewBid:isAsym?-1:0,skewAsk:isAsym?1:0};
      const action={type:open?"REPOSITION":"OPEN",label:shape,spec};plans.push(action);
      if(!open&&balances(s).x<EPS&&s.wallet.y>c.minSolReserve)plans.push({...action,acquireSol:(s.wallet.y-c.minSolReserve)*.25,label:shape+"+initial_inventory"});
    }
    if(mode==="adaptive")for(const a of [0,.25,.5,.75,1])for(const b of [0,.25,.5,.75,1]){plans.push({type:open?"REPOSITION":"OPEN",label:"hybrid_grid",spec:{shape:"hybrid",width:4,bidFraction:g.regime==="DOWNTREND"||g.flags.includes("TOXIC_BID")?0:.5,askFraction:g.flags.includes("TOXIC_ASK")?0:.5,alphaBid:a,alphaAsk:b,active:0}})}
    return plans;
  }
  function decide(s,c,mode="adaptive"){
    if(!fresh(s,c))return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"UNKNOWN_REFERENCE",candidates:[],regime:"UNKNOWN"};
    const g=classify(s,c),p=s.market.ref.price,r=risk(s,c,p);
    if(g.regime==="UNKNOWN"&&!r.violations.length&&!g.flags.includes("HOLDER_CONCENTRATION"))return {action:{type:s.bins.length?"HOLD":"NO_LP"},reason:"WARMUP_OR_INSUFFICIENT_FEATURES",regime:g.regime,risk:r,candidates:[]};
    if(["STRESS","DISTRIBUTION_RANGE","DEAD_RANGE","UNKNOWN"].includes(g.regime)||g.flags.includes("HOLDER_CONCENTRATION")){
      return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"MARKET_GATE",regime:g.regime,risk:r,candidates:[]};
    }
    const sc=forecast(s,c),results=candidatePlans(s,c,mode).map(a=>evaluate(s,c,a,sc)),feasible=results.filter(a=>a.feasible).sort((a,b)=>b.utility-a.utility),base=results[0];
    if(!s.bins.length&&!base?.feasible)return {action:{type:'NO_LP'},reason:'BASELINE_UNAVAILABLE_NO_DEPLOYMENT',regime:g.regime,risk:r,candidates:results};
    if(!feasible.length)return {action:{type:s.bins.length?"REMOVE_AND_HOLD":"NO_LP"},reason:"RISK_BLOCKED",regime:g.regime,risk:r,candidates:results};
    let best=feasible[0];
    if(base.feasible&&best.action.type!==base.action.type&&best.utility-base.utility<=c.uncertaintySol+c.minImprovementSol)best=base;
    if(best.action.type==="REPOSITION"&&(s.market.t-s.lastActionTime<c.cooldownSeconds||s.rebalances>=c.maxRebalances||s.turnover+s.rebalanceTurnover>=c.maxTurnoverSol)){if(base.feasible)best=base;else best=feasible.find(v=>v.action.type!=="REPOSITION")||{action:{type:"REMOVE_AND_HOLD"},feasible:false,reason:"REBALANCE_BUDGET"};}
    return {action:best.action,reason:best===base?"BASELINE_WINS_OR_MARGIN":"MAX_FEASIBLE_UTILITY",regime:g.regime,risk:r,selected:best,candidates:results,forecastLabel:"SYNTHETIC_EQUAL_WEIGHT_SCENARIOS_NOT_CALIBRATED"};
  }
  function liquidation(s,c){
    if(!fresh(s,c))return {status:"UNAVAILABLE",value:null};
    const p=s.market.ref.price,b=balances(s),depth=s.market.exitDepth;
    if(!Number.isFinite(depth)||depth<0)return {status:"UNAVAILABLE",value:null};
    const sell=Math.min(b.x,depth/p),remaining=b.x-sell,proceeds=sell*p*(1-c.slippageBps/10000);
    return {status:remaining>EPS?"PARTIAL":"ESTIMATE",value:remaining>EPS?null:b.y+proceeds,solProceeds:b.y+proceeds,unsoldMeme:remaining};
  }
  function requestConfig(request,overrides={}){
    const goals={defensive:{lambda:1,kappaSol:.3,targetRatio:.25},balanced:{},growth:{lambda:.25,kappaSol:.4,targetRatio:.65}};assert(Object.hasOwn(goals,request.goal??"balanced"),"invalid goal");
    return config({...goals[request.goal??"balanced"],...(request.horizonSeconds!=null?{forecastHorizonSeconds:finite(request.horizonSeconds,"horizon",1)}:{}),...overrides});
  }
  function createSession(request,overrides={},mode="adaptive"){
    const c=requestConfig(request,overrides),s=newState(request,c);
    assert(["adaptive","spot","curve","bid_ask","hybrid","asymmetric","hodl","sol_hold","manual"].includes(mode),"invalid mode");
    const staticMode=!["adaptive","hodl","sol_hold","manual"].includes(mode);
    let lastDecision=-Infinity,staticAttempted=false;
    if(mode==="hodl"||mode==="sol_hold"){release(s);claim(s);}
    function push(e){
      // Validate/commit the incoming event atomically. Never consume a rejected event ID.
      const trial=clone(s);event(trial,c,e);Object.assign(s,trial);
      const g=classify(s,c),rr=fresh(s,c)?risk(s,c,s.market.ref.price):null;
      const emergency=mode==="adaptive"&&(!fresh(s,c)||g.regime==="STRESS"||g.flags.includes("HOLDER_CONCENTRATION")||!!rr?.violations.length);
      if(emergency&&s.pending&&["OPEN","ADD","REPOSITION"].includes(s.pending.action.type)){const op=s.pending;s.pending=null;s.receipts.push({id:op.id,t:e.t,action:op.action.type,status:"CANCELLED",reason:"RISK_OVERRIDE"});}
      executePending(s,c,e.t);
      if(emergency&&s.bins.length&&!s.pending){const d={t:e.t,regime:g.regime,action:{type:"REMOVE_AND_HOLD"},reason:"HARD_RISK_OVERRIDE",selected:null,candidates:[]};s.decisions.push(d);lastDecision=e.t;submit(s,c,d.action,e.t);return;}
      if(e.type!=="MARKET"||s.pending||["manual","hodl","sol_hold"].includes(mode))return;
      if(e.t-lastDecision<c.cooldownSeconds)return;
      let d;
      if(staticMode){
        if(staticAttempted)return;
        const g=classify(s,c);
        if(!s.market.ref.valid||g.regime==="UNKNOWN")return;
        staticAttempted=true;
        const label=mode,shape=mode==="asymmetric"?"hybrid":mode;
        const action={type:s.bins.length?"REPOSITION":"OPEN",label,spec:{shape,width:4,bidFraction:.5,askFraction:.7,active:shape==="curve"?.2:shape==="spot"?.1:0,alphaBid:mode==="asymmetric"?.75:.5,alphaAsk:mode==="asymmetric"?.25:.5,skewBid:mode==="asymmetric"?-1:0,skewAsk:mode==="asymmetric"?1:0}};
        const v=evaluate(s,c,action,forecast(s,c));
        d={action:v.feasible?action:{type:"NO_LP"},reason:v.feasible?"FIXED_BENCHMARK":"FIXED_BENCHMARK_BLOCKED:"+v.reason,regime:g.regime,selected:v.feasible?v:null,candidates:[v]};
      }else d=decide(s,c,mode);
      s.decisions.push({t:e.t,regime:d.regime,action:d.action,reason:d.reason,selected:d.selected??null,candidates:d.candidates.map(x=>({label:x.action.label||x.action.type,action:x.action,utility:x.utility??null,feasible:x.feasible,reason:x.reason??null}))});lastDecision=e.t;
      if(!["HOLD","NO_LP"].includes(d.action.type))submit(s,c,d.action,e.t);
    }
    function action(a,options={}){
      assert(s.lastTime>=0,"feed market event first");
      if(s.pending){s.receipts.push({t:s.lastTime,status:"REJECTED",action:a.type,reason:"OPERATION_PENDING"});return;}
      submit(s,c,a,s.lastTime,options);
    }
    function analyze(){
      if(!fresh(s,c))return {action:{type:"NO_LP"},reason:"REFERENCE_UNAVAILABLE",candidates:[]};
      return decide(s,c,"adaptive");
    }
    function snapshot(){
      const m=s.market,valid=fresh(s,c);
      const report=valid?reportAt(s,m.ref.price):null;
      if(report)assert(Math.abs(report.residual)<1e-6*Math.max(1,Math.abs(report.nav)),"accounting residual");
      const status=!valid?"REFERENCE_UNAVAILABLE":s.quality.some(q=>q.reason==="FROZEN_PATH_SHARE_LIMIT")?"INVALID_SHARE_ASSUMPTION":s.pending?"PENDING":"SIMULATED";
      const curve=s.curve,avgCapital=curve.length?sum(curve.map(x=>x.nav))/curve.length:null;
      let capitalSeconds=0;for(let i=1;i<curve.length;i++)capitalSeconds+=curve[i-1].nav*(curve[i].t-curve[i-1].t);const duration=curve.length?curve.at(-1).t-curve[0].t:0;const timeWeightedNav=duration>0?capitalSeconds/duration:null;
      const maxInventoryX=Math.max(balances(s).x,...curve.map(x=>x.x)),minObservedSol=Math.min(balances(s).y,...curve.map(x=>x.y));
      return clone({source:"SYNTHETIC_OR_UNVERIFIED_NORMALIZED_EVENTS",calibrated:false,protocolExact:false,status,mode,entry:request.entry,report,liquidation:valid?liquidation(s,c):{status:"UNAVAILABLE",value:null},risk:valid?risk(s,c,m.ref.price):null,maxDrawdown:Math.max(0,...curve.map(x=>x.drawdown)),avgObservedNav:avgCapital,timeWeightedNav,capitalSeconds,netPerSolHour:report&&capitalSeconds>0?report.pnl*3600/capitalSeconds:null,maxInventoryX,minObservedSol,riskBreaches:s.riskLog.length,durationSeconds:curve.length?curve.at(-1).t-curve[0].t:0,state:s,config:c});
    }
    return {push,action,analyze,snapshot};
  }
  function run(request,events,overrides={},mode="adaptive",manual=[]){
    assert(Array.isArray(events)&&events.length,"events required");
    const session=createSession(request,overrides,mode);
    const sorted=manual.slice().sort((a,b)=>a.t-b.t);let mi=0;
    for(const e of events){session.push(e);while(mi<sorted.length&&sorted[mi].t<=e.t){const op=sorted[mi++];session.action(op.action,op.options||{});}}
    return session.snapshot();
  }
  function analyzeRequest(request,events,overrides={}){
    const s=createSession(request,overrides,"manual");for(const e of events)s.push(e);
    return {analysis:s.analyze(),snapshot:s.snapshot()};
  }
  function compare(request,events,overrides={}){
    const modes=["hodl","spot","curve","bid_ask","hybrid","asymmetric","adaptive"];
    const runs=modes.map(mode=>run(request,events,overrides,mode));
    return {source:runs[0].source,results:runs.map(r=>({mode:r.mode,status:r.status,report:r.report,maxDrawdown:r.maxDrawdown,risk:r.risk,liquidation:r.liquidation})),runs,solHold:{mode:"sol_hold",note:"Frictionless initial NAV held in SOL, separate opportunity baseline; no conversion modeled",pnl:0,nav:runs[0].state.initialNav}};
  }
  function demo(kind="range",overrides={}){
    const c=config(overrides),events=[],ids=kind==="up"?[0,1,2,3,4,5,6,7,8,9,10,11]:kind==="down"?[0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11]:kind==="crash"?[0,1,-1,2,0,-1,-30,-35,-40,-43,-45,-50]:[0,1,-1,2,-2,3,-3,2,-2,1,-1,0,2,-2,3,-3,0,1,-1,0];
    for(let i=0;i<ids.length;i++){
      const id=ids[i],p=price(c,id),t=i*60,qty=8/p,side=i&&id<ids[i-1]?"LP_BUY":"LP_SELL",fee=qty*c.feeBps/10000*(1-c.protocolShare);
      events.push({type:"MARKET",id:"m"+i,t,pool:"DEMO_POOL",references:[{pool:"DEMO_A",price:p,depth:80,availableAt:t},{pool:"DEMO_B",price:p,depth:60,availableAt:t}],exitDepth:kind==="crash"&&i>=6?0.5:30,tokenSafe:true,holderShare:.25,holderOutflow:0,buyImbalance:0,flowSol:32});
      events.push({type:"SWAP",id:"s"+i,t:t+1,bin:id,side,baseQty:qty,externalLiquiditySol:80,mmFeeX:side==="LP_BUY"?fee:0,mmFeeY:side==="LP_SELL"?fee*p:0});
    }
    return events;
  }
  function opportunities(pools,cfg={}){
    const c=config(cfg);return pools.map(pool=>{const s=newState({entry:"sol",meme:0,sol:10,initialPrice:c.referencePrice},c);for(const e of pool.events)event(s,c,e);const g=classify(s,c);return {pool:pool.id,...g,admitted:!["UNKNOWN","STRESS","DISTRIBUTION_RANGE","DEAD_RANGE"].includes(g.regime)&&!g.flags.includes("HOLDER_CONCENTRATION")}});}
  function evaluateSamples(samples,overrides={}){
    assert(Array.isArray(samples)&&samples.length,"samples required");
    const ids=new Set(),groups=new Map(),rows=[];
    for(const sample of samples){
      assert(typeof sample.id==="string"&&!ids.has(sample.id),"sample id missing or duplicate");ids.add(sample.id);
      assert(typeof sample.group==="string"&&sample.group.length,"group required");
      const split=sample.split??"scenario";assert(["train","validation","test","scenario"].includes(split),"invalid split");
      assert(!groups.has(sample.group)||groups.get(sample.group)===split,"group crosses frozen splits");groups.set(sample.group,split);
      const out=compare(sample.request,sample.events,overrides);
      const a=out.runs.find(r=>r.mode==="adaptive"),b=out.runs.find(r=>r.mode==="bid_ask");
      const valid=x=>x.status==="SIMULATED"&&x.report!==null;
      rows.push({id:sample.id,group:sample.group,split,source:"UNVERIFIED",result:out.results.map(x=>({mode:x.mode,status:x.status,pnl:x.report?.pnl??null,alpha:x.report?.alpha??null,fee:x.report?.fee??null,maxDrawdown:x.maxDrawdown})),delta:valid(a)&&valid(b)?a.report.pnl-b.report.pnl:null,adaptiveRiskBreaches:a.riskBreaches,adaptiveActions:a.state.decisions.map(d=>d.action.type)});
    }
    const summaries={};
    for(const split of new Set(rows.map(r=>r.split))){
      const all=rows.filter(r=>r.split===split),valid=all.filter(r=>r.delta!==null),byGroup=new Map();
      for(const v of valid){const l=byGroup.get(v.group)||[];l.push(v.delta);byGroup.set(v.group,l)}
      const means=[...byGroup.values()].map(l=>sum(l)/l.length).sort((a,b)=>a-b),n=means.length;
      summaries[split]={sampleCount:all.length,validCount:valid.length,independentGroupCount:n,meanGroupDelta:n?sum(means)/n:null,medianGroupDelta:n?means[Math.floor((n-1)/2)]:null,worstGroupDelta:n?means[0]:null,positiveGroupFraction:n?means.filter(x=>x>0).length/n:null,confidenceInterval:null,conclusion:"INCONCLUSIVE_UNVERIFIED_DATA_NO_CALIBRATION"};
    }
    return {source:"UNVERIFIED_OFFLINE_EXPERIMENT",parameterSelection:false,comparison:"Adaptive minus Static Bid-Ask, grouped by declared sample group",config:config(overrides),rows,summaries};
  }
  function scenarioSuite(request,overrides={}){
    return evaluateSamples(["range","up","down","crash"].map(name=>({id:name,group:name,split:"scenario",request,events:demo(name,overrides)})),overrides);
  }
  return {DEFAULTS,config,requestConfig,candidatePlans,price,binId,cvar,newState,balances,nav,hodl,reportAt,reference,classify,risk,bidCap,weights,planBins,applyAction,swap,event,submit,executePending,forecast,evaluate,decide,liquidation,run,compare,demo,opportunities,createSession,analyzeRequest,evaluateSamples,scenarioSuite};
}
export const Engine=createResearchEngine();
export {createResearchEngine};
