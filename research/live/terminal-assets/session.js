'use strict';
// Single session state. Each controller retains its original epoch and busy guard.
const families=['NO_LP','spot','curve','bid_ask','hybrid','asymmetric','hybrid_grid'],names={NO_LP:'No LP',spot:'Spot',curve:'Curve',bid_ask:'Bid-Ask',hybrid:'Hybrid',asymmetric:'Asymmetric',hybrid_grid:'Hybrid Grid'};
let perfWindow=null,perfGeneration=0,perfPositionScope=null,lifecycleReport=null,lifecycleGeneration=0;
let target='',report=null,draft=null,selected=null,importGeneration=0,shapeView='dynamic',poolEpoch=0;
let monitoring=new Map(),managementBusy=false,monitorSignature='',page='terminal',positionGeneration=0,positions=new Map(),positionSelected=null,managementSelected=null,shadow=null,shadowGeneration=0;
let previousTarget=target;
let holderRequestBusy=false,snapshotRequestBusy=false,replayRequestBusy=false,builderRequestBusy=false;
let modelInputGeneration=0;
let catalogGeneration=0,archiveBusy=false;
let serviceMarket=null,servicePool=null,serviceReview=null,refreshing=false,planBusy=false,refreshGeneration=0;
const servicePositions=new Set();
let autoMonitor=null,autoMonitorReading=false,autoRenderSignature='';
let observationEpoch=0,observationExpiry=0,observationBusy=false;
let positionReadEpoch=0,walletIndex=null,walletReadBusy=false,lastPositionRead=0,walletDetails=new Map();
let walletAddress=null,walletProvider=null,walletBusy=false,walletEpoch=0,reviewEpoch=0,activeReview=null,walletEvidenceBusy=false,walletEvidenceResult=null,reviewVerified=false,reviewExpiresAt=0;
let accountingGeneration=0,accountingBusy=false;
let externalEpoch=0,externalExpiry=0,externalReading=false;
