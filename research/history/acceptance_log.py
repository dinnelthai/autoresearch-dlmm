"""Stage execution logs and portable research acceptance evidence. No RPC or secrets in exports."""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

from build_dataset import ADDRESS, midnight, require, file_hash, schemas
from sync_dataset import read_manifest, verify, safe_path

ROOT=Path(__file__).resolve().parents[2]
STAGES={
    "candles":("node","research/history/backfill-candles.mjs"),
    "swaps":("node","research/history/backfill-swaps.mjs"),
    "decode":("node","research/live/inspect-swaps.mjs"),
    "quality":("node","research/history/sample-quality.mjs"),
    "archive":("node","research/history/archive-snapshots.mjs"),
    "dataset":("python","research/history/build_dataset.py"),
    "sync":("python","research/history/sync_dataset.py"),
}
SPLITS=("train","validation","test")
KINDS=("bin_snapshots","swaps")
REASON=re.compile(r"[A-Z0-9_]{1,100}")
STATES=re.compile(r"[A-Z0-9_]{1,100}")


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def version():
    try:
        r=subprocess.run(["git","rev-parse","HEAD"],cwd=ROOT,capture_output=True,text=True,timeout=5,check=True)
        value=r.stdout.strip()
        return value if re.fullmatch(r"[a-f0-9]{40}",value) else None
    except (OSError,subprocess.SubprocessError):
        return None


def event(log, run, stage, name, **fields):
    log.parent.mkdir(parents=True,exist_ok=True)
    record=dict(schemaVersion=1,runId=run,stage=stage,event=name,at=utc(),**fields)
    with log.open("a",encoding="utf8") as f:
        f.write(json.dumps(record,separators=(",",":"))+"\n")
        f.flush()
        os.fsync(f.fileno())


def run_stage(stage, args, logs):
    require(stage in STAGES,"STAGE")
    run=uuid.uuid4().hex
    log=logs/(run+".jsonl")
    executable,script=STAGES[stage]
    event(log,run,stage,"START",commit=version())
    start=time.monotonic()
    code=1
    try:
        result=subprocess.run([sys.executable if executable=="python" else executable,str(ROOT/script),*args],cwd=ROOT)
        code=result.returncode
    except KeyboardInterrupt:
        code=130
    except OSError:
        code=127
    finally:
        event(log,run,stage,"END",exitCode=code,elapsedMs=round((time.monotonic()-start)*1000))
    # No command arguments, stderr, environment, or raw process output stored.
    return code


def read_json(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size<=32*1024*1024,"EVIDENCE_FILE")
    return json.loads(path.read_bytes())


def label(value):
    return value if isinstance(value,str) and STATES.fullmatch(value) else "UNCLASSIFIED"


def number(value):
    return value if type(value) in (int,float) and value>=0 and value<float("inf") else None


def select_numbers(obj, keys):
    return {k:number(obj.get(k)) for k in keys}


def inspect_history(root,pools):
    """Inspect stage artifacts, not private config or raw account data."""
    results=[]
    issues=Counter()
    for pool in pools:
        base=root/pool
        if not base.is_dir():
            continue
        for p in sorted(base.glob("candles-*/manifest.json")):
            try:
                m=read_json(p)
                require(m["pool"]==pool and m["scope"]=="INDEXED_PRICE_VOLUME_ONLY","CANDLE_ID")
                results.append(dict(kind="candles",pool=pool,status=label(m["status"]),start=number(m["start"]),end=number(m["end"]),rows=number(m["rows"]),missingHours=len(m["missing"]),windows=len(m["windows"]),manifestSha256=file_hash(p)))
            except (ValueError,KeyError,TypeError,OSError):
                issues["CANDLE_MANIFEST_INVALID"]+=1
        for p in sorted(base.glob("swaps-*/checkpoint.json")):
            try:
                m=read_json(p)
                require(m["pool"]==pool and m["schemaVersion"]==1,"SWAP_ID")
                results.append(dict(kind="backfill",pool=pool,status=label(m["status"]),since=number(m["since"]),oldestObserved=number(m.get("oldestObserved")),signatures=number(m["signatures"]),batches=len(m["batches"]),lastFailure=bool(m.get("lastFailure")),manifestSha256=file_hash(p)))
            except (ValueError,KeyError,TypeError,OSError):
                issues["SWAP_CHECKPOINT_INVALID"]+=1
        for p in sorted(base.glob("snapshots/*/manifest.json")):
            try:
                m=read_json(p)
                require(m["pool"]==pool and m["day"]==p.parent.name and m["source"]=="EXISTING_FINALIZED_ACCOUNT_CAPTURES","ARCHIVE_ID")
                midnight(m["day"])
                reasons=Counter(label(i.get("reason")) for i in m["issues"])
                c=m["coverage"]
                results.append(dict(kind="archive",pool=pool,day=m["day"],status=label(m["status"]),coverage=select_numbers(c,("expectedBuckets","observedBuckets","missingBuckets","bucketCoverage","largestObservationGapMs","eligibleObservations")),inspected=number(m["inspected"]),duplicates=number(m["duplicates"]),conflictSlots=len(m["conflictSlots"]),issues=dict(reasons),bytes=number(m["bytes"]),manifestSha256=file_hash(p)))
            except (ValueError,KeyError,TypeError,OSError):
                issues["ARCHIVE_MANIFEST_INVALID"]+=1
    return results,dict(issues)


def inspect_quality(paths,pools):
    rows=[]
    for p in paths:
        try:
            q=read_json(p)
            require(q["pool"] in pools and q["historyComplete"] is False,"QUALITY_ID")
            fields={k:select_numbers(v,("present","total","fraction")) for k,v in q["coverage"].items() if k in ("amountInRaw","amountOutRaw","feeBpsFieldRaw","protocolFeeRaw","hostFeeRaw","mmFeeRaw","legacyFeeRaw","feeToken","startBinId","endBinId","blockTime","outerIndex","innerIndex")}
            rows.append(dict(pool=q["pool"],status=label(q["status"]),counts=select_numbers(q["counts"],("transactions","successful","failed","swaps","multiBin","invalid")),coverage=fields,gaps={k:number(v) for k,v in q["gaps"].items() if REASON.fullmatch(k)},minTime=number(q.get("minTime")),maxTime=number(q.get("maxTime")),manifestSha256=file_hash(p)))
        except (ValueError,KeyError,TypeError,OSError):
            rows.append(dict(status="QUALITY_REPORT_INVALID"))
    return rows


def inspect_logs(root):
    rows=[]
    invalid=0
    for p in sorted(root.glob("*.jsonl")):
        try:
            require(re.fullmatch(r"[a-f0-9]{32}\.jsonl",p.name) and not p.is_symlink() and p.stat().st_size<=65536,"LOG_ID")
            records=[json.loads(line) for line in p.read_text().splitlines()]
            require(1<=len(records)<=2,"LOG_RECORDS")
            start=records[0]
            require(start["runId"]==p.stem and start["stage"] in STAGES and start["event"]=="START","LOG_START")
            def time_value(v):
                t=dt.datetime.fromisoformat(v)
                require(t.tzinfo is not None,"LOG_TIME")
                return t.isoformat()
            r=dict(runId=p.stem,stage=start["stage"],startedAt=time_value(start["at"]),commit=start["commit"] if isinstance(start.get("commit"),str) and re.fullmatch(r"[a-f0-9]{40}",start["commit"]) else None,status="NO_END_RECORD")
            if len(records)==2:
                end=records[1]
                require(end["runId"]==p.stem and end["stage"]==start["stage"] and end["event"]=="END" and type(end["exitCode"]) is int,"LOG_END")
                r.update(endedAt=time_value(end["at"]),elapsedMs=number(end["elapsedMs"]),exitCode=end["exitCode"],status="EXIT_OK" if end["exitCode"]==0 else "EXIT_FAILED")
            rows.append(r)
        except (ValueError,KeyError,TypeError,OSError):
            invalid+=1
    return dict(runs=rows,invalidFiles=invalid)


def dataset_report(path,pools):
    import pyarrow as pa
    import pyarrow.parquet as pq
    verified=verify(path)
    _,m=read_manifest(path)
    require(set(m["pools"])==set(pools),"DATASET_POOL_SCOPE")
    stats={}
    types=schemas(pa)
    for f in m["files"]:
        kind,split,pool,day=(f[k] for k in ("kind","split","pool","day"))
        key=(kind,split,pool,day)
        s=stats.setdefault(key,dict(rows=0,slots=set(),times=set(),directions=Counter(),multiBin=0,fields=Counter(),minBin=None,maxBin=None))
        pf=pq.ParquetFile(safe_path(path,f["path"]))
        require(pf.schema_arrow.equals(types[kind],check_metadata=False) and pf.metadata.num_rows==f["rows"],"PARQUET_SCHEMA_OR_ROWS")
        columns=["slot","pool","day","split"]
        columns+=["observedAtMs","binId","amountXRaw","amountYRaw","priceQ64Raw","liquiditySupplyRaw","feeXPerTokenRaw","feeYPerTokenRaw"] if kind=="bin_snapshots" else ["blockTime","direction","startBinId","endBinId","amountInRaw","amountOutRaw","feeToken","mmFeeRaw","legacyFeeRaw"]
        for batch in pf.iter_batches(batch_size=4096,columns=columns):
            d=batch.to_pydict()
            require(all(x==pool for x in d["pool"]) and all(x==day for x in d["day"]) and all(x==split for x in d["split"]),"ROW_PARTITION")
            s["rows"]+=batch.num_rows
            s["slots"].update(d["slot"])
            s["times"].update(d["observedAtMs"] if kind=="bin_snapshots" else [t*1000 for t in d["blockTime"]])
            for k in columns[4:]:
                s["fields"][k]+=sum(x is not None for x in d[k])
            if kind=="swaps":
                s["directions"].update(d["direction"])
                s["multiBin"]+=sum(a!=b for a,b in zip(d["startBinId"],d["endBinId"]))
            else:
                lo,hi=min(d["binId"]),max(d["binId"])
                s["minBin"]=lo if s["minBin"] is None else min(s["minBin"],lo)
                s["maxBin"]=hi if s["maxBin"] is None else max(s["maxBin"],hi)
    daily=[]
    for (kind,split,pool,day),s in sorted(stats.items()):
        times=sorted(s["times"])
        daily.append(dict(kind=kind,split=split,pool=pool,day=day,rows=s["rows"],distinctSlots=len(s["slots"]),distinctTimes=len(times),firstTimeMs=times[0] if times else None,lastTimeMs=times[-1] if times else None,maxInteriorGapMs=max((b-a for a,b in zip(times,times[1:])),default=None),fields=dict(s["fields"]),directions={k:s["directions"][k] for k in ("X_TO_Y","Y_TO_X")},multiBin=s["multiBin"],minBin=s["minBin"],maxBin=s["maxBin"]))
    bounds=[midnight(m["boundariesUtc"][k]) for k in ("start","validationStart","testStart","end")]
    summary=[]
    for pool in pools:
        for kind in KINDS:
            for i,split in enumerate(SPLITS):
                d=[r for r in daily if r["pool"]==pool and r["kind"]==kind and r["split"]==split]
                expected=(bounds[i+1]-bounds[i])//86400000
                summary.append(dict(pool=pool,kind=kind,split=split,expectedDays=expected,daysWithRows=len(d),missingDays=expected-len(d),rows=sum(r["rows"] for r in d),sumDailyDistinctSlots=sum(r["distinctSlots"] for r in d),sumDailyDistinctTimes=sum(r["distinctTimes"] for r in d)))
    return dict(verification=verified,boundariesUtc=m["boundariesUtc"],summary=summary,daily=daily,historyComplete=False,exactReplayReady=False)


def export(args):
    pools=args.pool
    require(1<=len(pools)<=5 and len(set(pools))==len(pools) and all(ADDRESS.fullmatch(p) for p in pools),"POOLS")
    artifacts,issues=inspect_history(args.history,pools)
    report=dict(schemaVersion=1,kind="DLMM_RESEARCH_ACCEPTANCE_EVIDENCE",createdAt=utc(),commit=version(),pools=pools,historyArtifacts=artifacts,historyArtifactErrors=issues,swapQuality=inspect_quality(args.quality,pools),stageLogs=inspect_logs(args.logs),dataset=None,datasetStatus="NOT_PROVIDED",historyComplete=False,exactReplayReady=False,statisticalSufficiency="REQUIRES_RESEARCH_HYPOTHESIS_AND_REVIEW",gpuReady=False)
    if args.dataset:
        try:
            report["dataset"]=dataset_report(args.dataset,pools)
            report["datasetStatus"]="HASH_AND_SCHEMA_CHECKED_UNVERIFIED"
        except (ValueError,KeyError,TypeError,OSError,ImportError):
            report["datasetStatus"]="DATASET_VERIFICATION_FAILED"
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open("x",encoding="utf8") as f:
        json.dump(report,f,indent=2)
        f.write("\n")
    print(json.dumps(dict(output=str(args.output),datasetStatus=report["datasetStatus"],artifacts=len(artifacts),logs=len(report["stageLogs"]["runs"]))))
    return 1 if report["datasetStatus"]=="DATASET_VERIFICATION_FAILED" else 0


if __name__=="__main__":
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="command",required=True)
    r=sub.add_parser("run")
    r.add_argument("stage",choices=STAGES)
    r.add_argument("--logs",type=Path,default=ROOT/"data/historical/logs")
    r.add_argument("args",nargs=argparse.REMAINDER)
    e=sub.add_parser("export")
    e.add_argument("--pool",action="append",required=True)
    e.add_argument("--history",type=Path,default=ROOT/"data/historical")
    e.add_argument("--logs",type=Path,default=ROOT/"data/historical/logs")
    e.add_argument("--quality",type=Path,action="append",default=[])
    e.add_argument("--dataset",type=Path)
    e.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if a.command=="run":
        rest=a.args[1:] if a.args[:1]==["--"] else a.args
        sys.exit(run_stage(a.stage,rest,a.logs))
    sys.exit(export(a))
