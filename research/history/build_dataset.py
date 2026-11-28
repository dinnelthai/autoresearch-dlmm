"""Explicit, immutable research export. No network or strategy execution."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import re
import shutil
import tempfile
from collections import defaultdict
from pathlib import Path

DAY = 86400000
ADDRESS = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
HASH = re.compile(r"[a-f0-9]{64}")
RAW64 = ("amountXRaw", "amountYRaw")
RAW128 = ("priceQ64Raw", "liquiditySupplyRaw", "feeXPerTokenRaw", "feeYPerTokenRaw")
ORDERS = ("openOrderAmountRaw", "totalProcessingOrderAmountRaw", "processedOrderRemainingAmountRaw")
SWAP_RAW = ("amountInRaw", "amountOutRaw", "feeBpsFieldRaw", "protocolFeeRaw", "hostFeeRaw", "mmFeeRaw", "legacyFeeRaw", "amountLeftRaw", "limitOrderFeeRaw")


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open("rb") as f:
        h = hashlib.sha256()
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
        return h.hexdigest()


def load(path):
    raw = path.read_bytes()
    return json.loads(raw), digest(raw)


def midnight(value):
    day = dt.date.fromisoformat(value)
    require(day.isoformat() == value, "DAY_FORMAT")
    return int(dt.datetime.combine(day, dt.time(), dt.timezone.utc).timestamp()) * 1000


def day_of(ms):
    return dt.datetime.fromtimestamp(ms // 1000, dt.timezone.utc).date().isoformat()


def integer(value, name, minimum=0, maximum=2**63-1):
    require(type(value) is int and minimum <= value <= maximum, name)
    return value


def raw_uint(value, bits, optional=False):
    if optional and value is None:
        return None
    require(isinstance(value, str) and len(value) <= 39 and re.fullmatch(r"0|[1-9]\d*", value) and int(value) < 2**bits, "RAW_UINT")
    return value


def partition(ms, boundaries):
    integer(ms, "TIMESTAMP")
    a, b, c, d = boundaries
    require(a <= ms < d, "OUTSIDE_FROZEN_WINDOW")
    return "train" if ms < b else "validation" if ms < c else "test"


def schemas(pa):
    def fields(names, typ):
        return [(name, typ) for name in names]
    common = fields(("pool", "day", "split", "source_sha256"), pa.string())
    snapshot = common + fields(("slot", "observedAtMs"), pa.int64()) + fields(("rawHash", "capture", "sdkCommit", "idlBlob", "mintX", "mintY"), pa.string()) + fields(("decimalsX", "decimalsY", "activeId", "binStep", "arrayIndex", "arrayVersion", "binId"), pa.int64()) + fields(("arrayAddress",) + RAW64 + RAW128 + ORDERS, pa.string())
    swap = common + fields(("id", "signature", "event", "direction", "source", "sdkCommit", "idlBlob", "feeToken"), pa.string()) + fields(("slot", "txIndex", "eventIndex", "blockTime", "outerIndex", "innerIndex", "startBinId", "endBinId"), pa.int64()) + fields(SWAP_RAW, pa.string()) + fields(("feeOnInput",), pa.bool_())
    return {"bin_snapshots": pa.schema(snapshot), "swaps": pa.schema(swap)}


def snapshot_records(manifest_path, pools, boundaries, seen_slots):
    m, source_sha = load(manifest_path)
    pool, day = m["pool"], m["day"]
    require(pool in pools and m.get("schemaVersion") == 1 and m.get("source") == "EXISTING_FINALIZED_ACCOUNT_CAPTURES" and m.get("clock") == "LOCAL_RPC_RECEIPT_UTC_NOT_CHAIN_TIME", "SNAPSHOT_MANIFEST")
    start = midnight(day)
    split = partition(start, boundaries)
    name = m["file"]
    require(isinstance(name, str) and re.fullmatch(r"snapshots-[a-f0-9]{64}\.ndjson\.gz", name) and name == "snapshots-"+m["sha256"]+".ndjson.gz", "SNAPSHOT_PATH")
    path = manifest_path.parent / name
    require(path.is_file() and not path.is_symlink() and path.stat().st_size == m["bytes"] and file_hash(path) == m["sha256"], "SNAPSHOT_DIGEST")
    count = 0
    with gzip.open(path, "rt", encoding="utf8") as f:
        for line in f:
            r = json.loads(line)
            ms = integer(r["observedAtMs"], "OBSERVED_TIME")
            slot = integer(r["slot"], "SLOT")
            require(start <= ms < start+DAY and r["pool"] == pool and r["status"] == "OBSERVED_SNAPSHOT_UNVERIFIED" and r["scope"] == "BITMAP_MARKED_ARRAYS_ONLY", "SNAPSHOT_IDENTITY")
            require(isinstance(r["rawHash"], str) and HASH.fullmatch(r["rawHash"]) and re.fullmatch(r"data/raw/accounts-[a-zA-Z0-9]+", r["capture"]), "RAW_PROVENANCE")
            require((pool, slot) not in seen_slots, "OVERLAPPING_SNAPSHOT_SLOT")
            seen_slots.add((pool, slot))
            for key in ("sdkCommit", "idlBlob"):
                require(isinstance(r[key], str) and re.fullmatch(r"[a-f0-9]{40}", r[key]), "VERSION_ID")
            for key in ("mintX", "mintY"):
                require(isinstance(r[key], str) and ADDRESS.fullmatch(r[key]), "MINT")
            for key in ("decimalsX", "decimalsY"):
                integer(r[key], key, 0, 18)
            integer(r["activeId"], "ACTIVE_BIN", -2**31, 2**31-1)
            integer(r["binStep"], "BIN_STEP", 1, 65535)
            base = {k:r[k] for k in ("slot", "observedAtMs", "rawHash", "capture", "sdkCommit", "idlBlob", "mintX", "mintY", "decimalsX", "decimalsY", "activeId", "binStep")}
            base.update(pool=pool, day=day, split=split, source_sha256=source_sha)
            ids = set()
            for a in r["arrays"]:
                index = integer(a["index"], "ARRAY_INDEX", -2**31, 2**31-1)
                version = integer(a["version"], "ARRAY_VERSION", 2, 3)
                lower = integer(a["lowerBinId"], "LOWER_BIN", -2**31, 2**31-1)
                require(a["upperBinId"] == lower+69 and len(a["bins"]) == 70 and ADDRESS.fullmatch(a["address"]), "ARRAY_LAYOUT")
                for i, b in enumerate(a["bins"]):
                    bid = integer(b["binId"], "BIN_ID", -2**31, 2**31-1)
                    require(bid == lower+i and bid not in ids, "BIN_IDENTITY")
                    ids.add(bid)
                    row = dict(base, arrayIndex=index, arrayVersion=version, arrayAddress=a["address"], binId=bid)
                    row.update({k:raw_uint(b[k],64) for k in RAW64})
                    row.update({k:raw_uint(b[k],128) for k in RAW128})
                    row.update({k:raw_uint(b.get(k),64,optional=(version == 2)) for k in ORDERS})
                    require(version != 2 or all(row[k] is None for k in ORDERS), "V2_ORDER_SEMANTICS")
                    yield row
            require(r["activeId"] in ids, "ACTIVE_BIN_MISSING")
            count += 1
    require(count == m["coverage"]["eligibleObservations"], "SNAPSHOT_COUNT")
    require(m["coverage"].get("historyComplete") is False, "FALSE_COMPLETENESS")


def swap_records(report_path, quality_path, pools, boundaries, seen_tx):
    r, source_sha = load(report_path)
    q, _ = load(quality_path)
    pool = r["pool"]
    require(pool in pools and r.get("position") is None and r.get("status") == "EVENTS_DECODED_UNVERIFIED" and not r["gaps"], "SWAP_REPORT_PARTIAL")
    require(q.get("pool") == pool and q.get("inputSha256") == source_sha and q.get("status") == "BOUNDED_EVENTS_USABLE_FOR_SCHEMA_RESEARCH" and q.get("historyComplete") is False and q["counts"]["swaps"] == len(r["events"]), "SWAP_QUALITY_BINDING")
    for k in ("sdkCommit", "idlBlob"):
        require(isinstance(r[k], str) and re.fullmatch(r"[a-f0-9]{40}",r[k]), "VERSION_ID")
    txs, counts, ids = {}, defaultdict(int), set()
    for t in r["transactions"]:
        sig = t["signature"]
        require(isinstance(sig,str) and re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{64,88}",sig) and (pool,sig) not in seen_tx and sig not in txs, "OVERLAPPING_TRANSACTION")
        integer(t["slot"], "SLOT")
        integer(t["txIndex"], "TX_INDEX")
        require(type(t["success"]) is bool, "TX_STATUS")
        txs[sig] = t
        seen_tx.add((pool,sig))
    for e in r["events"]:
        t = txs.get(e["signature"])
        require(t and t["success"] and e["pool"] == pool and all(e[k] == t[k] for k in ("slot","txIndex","blockTime")), "SWAP_IDENTITY")
        require(isinstance(e["id"],str) and e["id"] and e["id"] not in ids and e["event"] in ("Swap","Swap2Evt") and e["direction"] in ("X_TO_Y","Y_TO_X"), "SWAP_EVENT")
        require(e["source"] == "CPI", "SWAP_INSTRUCTION_EVIDENCE")
        ids.add(e["id"])
        counts[e["signature"]] += 1
        seconds = integer(e["blockTime"], "BLOCK_TIME", 0, 253402300799)
        ms = seconds*1000
        row = {k:e[k] for k in ("id","signature","event","direction","source","slot","txIndex","blockTime")}
        for k in ("eventIndex","outerIndex","innerIndex"):
            row[k] = integer(e[k], k)
        for k in ("startBinId","endBinId"):
            row[k] = integer(e[k], k, -2**31, 2**31-1)
        for k in SWAP_RAW:
            optional = k in ("mmFeeRaw","legacyFeeRaw","amountLeftRaw","limitOrderFeeRaw")
            row[k] = raw_uint(e.get(k),128 if k=="feeBpsFieldRaw" else 64,optional)
        row["feeToken"] = e.get("feeToken")
        row["feeOnInput"] = e.get("feeOnInput")
        require(row["feeToken"] in (None,"X","Y") and (row["feeOnInput"] is None or type(row["feeOnInput"]) is bool), "FEE_SIDE")
        if e["event"] == "Swap":
            require(row["legacyFeeRaw"] is not None and row["mmFeeRaw"] is None and row["feeToken"] is None, "LEGACY_FEE_SEMANTICS")
        else:
            require(row["mmFeeRaw"] is not None and row["feeToken"] is not None and type(row["feeOnInput"]) is bool and row["legacyFeeRaw"] is None, "SWAP2_FEE_SEMANTICS")
        row.update(pool=pool,day=day_of(ms),split=partition(ms,boundaries),source_sha256=source_sha,sdkCommit=r["sdkCommit"],idlBlob=r["idlBlob"])
        yield row
    require(all(not t["success"] or t["eventCount"] == counts[sig] for sig,t in txs.items()), "SWAP_EVENT_COUNT")


def build(spec_path, output):
    import pyarrow as pa
    import pyarrow.parquet as pq
    spec, spec_sha = load(spec_path)
    require(spec.get("schemaVersion")==1 and isinstance(spec.get("pools"),list) and 1<=len(spec["pools"])<=5, "SPEC")
    pools = set(spec["pools"])
    require(len(pools)==len(spec["pools"]) and all(isinstance(p,str) and ADDRESS.fullmatch(p) for p in pools), "POOLS")
    boundaries = tuple(midnight(spec[k]) for k in ("start","validationStart","testStart","end"))
    require(all(a<b for a,b in zip(boundaries,boundaries[1:])), "SPLIT_ORDER")
    snaps, swaps = spec.get("snapshotManifests",[]), spec.get("swapReports",[])
    require(isinstance(snaps,list) and isinstance(swaps,list) and (snaps or swaps), "INPUTS")
    output = output.resolve()
    require(not output.exists(), "OUTPUT_EXISTS")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".dataset-", dir=output.parent))
    types = schemas(pa)
    seen_slots, seen_tx = set(), set()
    files, inputs = [], []
    counts = defaultdict(int)
    def source(value):
        require(isinstance(value,str) and value, "INPUT_PATH")
        return (spec_path.parent / value).resolve()
    def emit(kind, records, index):
        buffers = defaultdict(list)
        parts = defaultdict(int)
        def flush(key):
            rows = buffers[key]
            if not rows:
                return
            split,pool,day = key
            rel = Path(kind)/split/pool/day/f"{index:06d}-{parts[key]:06d}.parquet"
            path = stage/rel
            path.parent.mkdir(parents=True,exist_ok=True)
            pq.write_table(pa.Table.from_pylist(rows,schema=types[kind]),path,compression="zstd")
            files.append({"path":rel.as_posix(),"rows":len(rows),"sha256":file_hash(path),"bytes":path.stat().st_size,"kind":kind,"split":split,"pool":pool,"day":day})
            counts[kind+"/"+split] += len(rows)
            parts[key]+=1
            rows.clear()
        for row in records:
            key=(row["split"],row["pool"],row["day"])
            buffers[key].append(row)
            if len(buffers[key])>=4096:
                flush(key)
        for key in buffers:
            flush(key)
    try:
        for i, item in enumerate(snaps):
            p = source(item)
            m, sha = load(p)
            inputs.append({"kind":"snapshot","sha256":sha,"pool":m["pool"],"day":m["day"],"coverage":m["coverage"],"issueCount":len(m["issues"])})
            emit("bin_snapshots",snapshot_records(p,pools,boundaries,seen_slots),i)
        for i,item in enumerate(swaps):
            p,q = source(item["report"]),source(item["quality"])
            inputs.append({"kind":"swap","sha256":file_hash(p),"qualitySha256":file_hash(q)})
            emit("swaps",swap_records(p,q,pools,boundaries,seen_tx),i)
        require(files, "NO_ELIGIBLE_ROWS")
        manifest={"schemaVersion":1,"status":"OBSERVED_RESEARCH_DATA_UNVERIFIED","specSha256":spec_sha,"pools":sorted(pools),"boundariesUtc":{k:spec[k] for k in ("start","validationStart","testStart","end")},"clocks":{"bin_snapshots":"LOCAL_RPC_RECEIPT_UTC","swaps":"CHAIN_BLOCK_TIME_UTC"},"counts":dict(counts),"inputs":inputs,"files":files,"historyComplete":False,"exactReplayReady":False,"calibrated":False,"profitabilityEvidence":False}
        (stage/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
        require(not output.exists(),"OUTPUT_EXISTS")
        stage.rename(output)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--spec",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    result=build(args.spec.resolve(),args.output)
    print(json.dumps({"status":result["status"],"counts":result["counts"],"output":str(args.output)}))
