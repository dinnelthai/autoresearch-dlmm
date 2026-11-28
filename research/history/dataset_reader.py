"""Verified, bounded Parquet iteration for one explicit split. No GPU required."""
from pathlib import Path
from build_dataset import schemas, require
from sync_dataset import read_manifest, safe_path, check_file, verify


def batches(root, *, kind, split, columns=None, pool=None, batch_size=4096):
    import pyarrow as pa
    import pyarrow.parquet as pq
    root=Path(root)
    require(kind in ("bin_snapshots","swaps") and split in ("train","validation","test"),"EXPLICIT_KIND_AND_SPLIT_REQUIRED")
    require(type(batch_size) is int and 1<=batch_size<=65536,"BATCH_SIZE")
    verify(root)
    _,m=read_manifest(root)
    require(pool is None or pool in m["pools"],"POOL_NOT_IN_DATASET")
    schema=schemas(pa)[kind]
    require(columns is None or (isinstance(columns,list) and columns and len(columns)==len(set(columns)) and all(c in schema.names for c in columns)),"COLUMNS")
    files=[f for f in m["files"] if f["kind"]==kind and f["split"]==split and (pool is None or f["pool"]==pool)]
    require(files,"EMPTY_REQUESTED_PARTITION")
    for f in sorted(files,key=lambda f:(f["day"],f["pool"],f["path"])):
        p=safe_path(root,f["path"])
        require(check_file(p,f),"FILE_CHANGED")
        pf=pq.ParquetFile(p)
        require(pf.schema_arrow.equals(schema,check_metadata=False) and pf.metadata.num_rows==f["rows"],"PARQUET_SCHEMA_OR_ROWS")
        # Preserve raw string columns. No implicit float conversion or cross-clock join.
        yield from pf.iter_batches(batch_size=batch_size,columns=columns)
