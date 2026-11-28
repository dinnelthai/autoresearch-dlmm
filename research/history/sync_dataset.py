"""Copy only a frozen Parquet dataset to/from a mounted filesystem (e.g. Drive)."""
import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections import Counter
from pathlib import Path

from build_dataset import ADDRESS, HASH, midnight, require, file_hash

PATTERN = re.compile(r"(bin_snapshots|swaps)/(train|validation|test)/([1-9A-HJ-NP-Za-km-z]{32,44})/(\d{4}-\d{2}-\d{2})/(\d{6}-\d{6}\.parquet)")
FLAGS = ("historyComplete", "exactReplayReady", "calibrated", "profitabilityEvidence")


def safe_path(root, rel):
    p = root
    for name in rel.split("/"):
        require(name not in ("", ".", "..") and "\\" not in name, "PATH_INVALID")
        p = p / name
        require(not p.is_symlink(), "SYMLINK_FORBIDDEN")
    return p


def read_manifest(root):
    p = safe_path(root, "manifest.json")
    require(p.is_file() and p.stat().st_size <= 32*1024*1024, "MANIFEST_MISSING_OR_TOO_LARGE")
    raw = p.read_bytes()
    m = json.loads(raw)
    require(m.get("schemaVersion") == 1 and m.get("status") == "OBSERVED_RESEARCH_DATA_UNVERIFIED" and all(m.get(k) is False for k in FLAGS), "MANIFEST_FIDELITY")
    pools = m["pools"]
    require(isinstance(pools,list) and 1 <= len(pools) <= 5 and len(set(pools)) == len(pools) and all(isinstance(p,str) and ADDRESS.fullmatch(p) for p in pools), "POOLS")
    bounds = tuple(midnight(m["boundariesUtc"][k]) for k in ("start","validationStart","testStart","end"))
    require(all(a < b for a,b in zip(bounds,bounds[1:])), "SPLIT_ORDER")
    files = m["files"]
    require(isinstance(files,list) and 0 < len(files) <= 100000, "FILES")
    seen, counts = set(), Counter()
    for f in files:
        rel = f["path"]
        match = PATTERN.fullmatch(rel) if isinstance(rel,str) else None
        require(match and rel not in seen, "FILE_PATH")
        seen.add(rel)
        kind, split, pool, day, _ = match.groups()
        require(pool in pools and all(f[k] == v for k,v in zip(("kind","split","pool","day"),(kind,split,pool,day))), "PARTITION_IDENTITY")
        t = midnight(day)
        a,b,c,d = bounds
        require(a<=t<d and split == ("train" if t<b else "validation" if t<c else "test"), "PARTITION_TIME")
        require(type(f["rows"]) is int and 0<f["rows"]<=4096 and type(f["bytes"]) is int and f["bytes"]>0 and isinstance(f["sha256"],str) and HASH.fullmatch(f["sha256"]), "FILE_METADATA")
        counts[kind+"/"+split] += f["rows"]
    require(dict(counts)==m["counts"], "ROW_COUNTS")
    return raw, m


def check_file(path, f):
    return path.is_file() and not path.is_symlink() and path.stat().st_size == f["bytes"] and file_hash(path) == f["sha256"]


def verify(root):
    root = Path(root)
    raw, m = read_manifest(root)
    for f in m["files"]:
        require(check_file(safe_path(root,f["path"]), f), "DATASET_HASH_MISMATCH: "+f["path"])
    return {"status":"HASH_VERIFIED_RESEARCH_DATA_UNVERIFIED","manifestSha256":hashlib.sha256(raw).hexdigest(),"files":len(m["files"]),"bytes":sum(f["bytes"] for f in m["files"]),"counts":m["counts"],"historyComplete":False,"exactReplayReady":False}


def write_atomic(path, raw):
    fd, name = tempfile.mkstemp(prefix=".sync-", dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def sync(source, dest):
    source, dest = Path(source).resolve(), Path(dest).resolve()
    require(source != dest and source not in dest.parents and dest not in source.parents, "OVERLAPPING_ROOTS")
    raw, m = read_manifest(source)
    # Validate all source payloads before publishing or copying anything.
    verify(source)
    dest.mkdir(parents=True,exist_ok=True)
    lock = safe_path(dest,".sync.lock")
    fd = os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    os.close(fd)
    try:
        manifest = safe_path(dest,"manifest.json")
        pending = safe_path(dest,".pending-manifest.json")
        # A committed dataset is immutable. A corrupt committed copy must be
        # repaired explicitly by removing it from service and using a new destination.
        if manifest.exists():
            require(manifest.read_bytes()==raw,"DESTINATION_MANIFEST_CONFLICT")
            result=verify(dest)
            return dict(result,copied=0,reused=len(m["files"]))
        if pending.exists():
            require(pending.read_bytes()==raw,"PENDING_MANIFEST_CONFLICT")
        else:
            require(not any(p.name!=".sync.lock" for p in dest.iterdir()),"DESTINATION_NOT_EMPTY")
            write_atomic(pending,raw)
        copied=reused=0
        for f in m["files"]:
            src=safe_path(source,f["path"])
            dst=safe_path(dest,f["path"])
            if check_file(dst,f):
                reused+=1
                continue
            require(not dst.exists() or dst.is_file(),"DESTINATION_FILE_CONFLICT")
            dst.parent.mkdir(parents=True,exist_ok=True)
            tmpfd,name=tempfile.mkstemp(prefix=".sync-",dir=dst.parent)
            try:
                with os.fdopen(tmpfd,"wb") as out,src.open("rb") as inp:
                    shutil.copyfileobj(inp,out,1024*1024)
                    out.flush()
                    os.fsync(out.fileno())
                require(check_file(Path(name),f),"COPY_HASH_MISMATCH")
                os.replace(name,dst)
                copied+=1
            finally:
                if os.path.exists(name):
                    os.unlink(name)
        for f in m["files"]:
            require(check_file(safe_path(dest,f["path"]),f),"FINAL_HASH_MISMATCH")
        require(safe_path(source,"manifest.json").read_bytes()==raw,"SOURCE_MANIFEST_CHANGED")
        # The manifest is the local publish marker; Drive propagation is asynchronous.
        write_atomic(manifest,raw)
        pending.unlink()
        result=verify(dest)
        return dict(result,copied=copied,reused=reused)
    finally:
        lock.unlink()


if __name__=="__main__":
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="cmd",required=True)
    v=sub.add_parser("verify")
    v.add_argument("root",type=Path)
    s=sub.add_parser("sync")
    s.add_argument("source",type=Path)
    s.add_argument("destination",type=Path)
    a=p.parse_args()
    print(json.dumps(verify(a.root) if a.cmd=="verify" else sync(a.source,a.destination),indent=2))
