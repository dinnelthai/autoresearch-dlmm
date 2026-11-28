import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pyarrow.parquet as pq
from build_dataset import build, midnight, partition, raw_uint

POOL="A"*32
SIG="B"*88
SHA="c"*40
H="d"*64
DAY="2026-11-01"


def put(path,obj):
    path.write_text(json.dumps(obj))
    return hashlib.sha256(path.read_bytes()).hexdigest()


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.spec={"schemaVersion":1,"pools":[POOL],"start":DAY,"validationStart":"2026-11-02","testStart":"2026-11-03","end":"2026-11-04","snapshotManifests":[],"swapReports":[]}

    def snapshot(self):
        b=[dict(binId=i,amountXRaw=str(2**64-1),amountYRaw="0",priceQ64Raw=str(2**128-1),liquiditySupplyRaw="1",feeXPerTokenRaw="2",feeYPerTokenRaw="3",openOrderAmountRaw=None,totalProcessingOrderAmountRaw=None,processedOrderRemainingAmountRaw=None) for i in range(70)]
        r=dict(pool=POOL,slot=5,observedAtMs=midnight(DAY),rawHash=H,capture="data/raw/accounts-abc123",sdkCommit=SHA,idlBlob=SHA,mintX="E"*32,mintY="F"*32,decimalsX=6,decimalsY=9,activeId=0,binStep=25,scope="BITMAP_MARKED_ARRAYS_ONLY",status="OBSERVED_SNAPSHOT_UNVERIFIED",arrays=[dict(index=0,address="G"*32,version=2,lowerBinId=0,upperBinId=69,bins=b)])
        data=gzip.compress((json.dumps(r)+"\n").encode())
        h=hashlib.sha256(data).hexdigest()
        name="snapshots-"+h+".ndjson.gz"
        (self.root/name).write_bytes(data)
        put(self.root/"snapshot.json",dict(schemaVersion=1,pool=POOL,day=DAY,source="EXISTING_FINALIZED_ACCOUNT_CAPTURES",clock="LOCAL_RPC_RECEIPT_UTC_NOT_CHAIN_TIME",file=name,sha256=h,bytes=len(data),issues=[],coverage=dict(eligibleObservations=1,historyComplete=False)))
        self.spec["snapshotManifests"]=["snapshot.json"]

    def swap(self):
        seconds=midnight("2026-11-02")//1000
        t=dict(signature=SIG,slot=9,txIndex=0,blockTime=seconds,success=True,eventCount=1)
        e=dict(signature=SIG,id=SIG+":CPI:0:0",pool=POOL,slot=9,txIndex=0,blockTime=seconds,event="Swap",direction="X_TO_Y",source="CPI",eventIndex=0,outerIndex=0,innerIndex=0,startBinId=-1,endBinId=1,amountInRaw="9007199254740993",amountOutRaw="1",feeBpsFieldRaw="1",protocolFeeRaw="0",hostFeeRaw="0",legacyFeeRaw="1",mmFeeRaw=None)
        sha=put(self.root/"swap.json",dict(pool=POOL,position=None,status="EVENTS_DECODED_UNVERIFIED",gaps=[],sdkCommit=SHA,idlBlob=SHA,transactions=[t],events=[e]))
        put(self.root/"quality.json",dict(pool=POOL,inputSha256=sha,status="BOUNDED_EVENTS_USABLE_FOR_SCHEMA_RESEARCH",historyComplete=False,counts=dict(swaps=1)))
        self.spec["swapReports"]=[dict(report="swap.json",quality="quality.json")]

    def run_build(self):
        path=self.root/"spec.json"
        put(path,self.spec)
        return build(path,self.root/"out")

    def test_roundtrip_separate_tables_exact_int_and_splits(self):
        self.snapshot()
        self.swap()
        r=self.run_build()
        self.assertEqual(r["counts"],{"bin_snapshots/train":70,"swaps/validation":1})
        self.assertFalse(r["exactReplayReady"])
        for f in r["files"]:
            table=pq.ParquetFile(self.root/"out"/f["path"]).read()
            self.assertEqual(table.num_rows,f["rows"])
            if f["kind"]=="bin_snapshots":
                self.assertEqual(table["priceQ64Raw"][0].as_py(),str(2**128-1))
            else:
                self.assertIsNone(table["mmFeeRaw"][0].as_py())
                self.assertEqual(table["amountInRaw"][0].as_py(),"9007199254740993")

    def test_duplicate_slot_rejected_atomically(self):
        self.snapshot()
        self.spec["snapshotManifests"]*=2
        with self.assertRaisesRegex(ValueError,"OVERLAPPING_SNAPSHOT_SLOT"):
            self.run_build()
        self.assertFalse((self.root/"out").exists())

    def test_quality_hash_mismatch(self):
        self.swap()
        p=self.root/"swap.json"
        p.write_text(p.read_text()+"\n")
        with self.assertRaisesRegex(ValueError,"SWAP_QUALITY_BINDING"):
            self.run_build()
        self.assertFalse((self.root/"out").exists())

    def test_duplicate_transactions(self):
        self.swap()
        self.spec["swapReports"]*=2
        with self.assertRaisesRegex(ValueError,"OVERLAPPING_TRANSACTION"):
            self.run_build()

    def test_split_boundary_and_uint(self):
        b=tuple(midnight(x) for x in ("2026-11-01","2026-11-02","2026-11-03","2026-11-04"))
        self.assertEqual(partition(b[1],b),"validation")
        self.assertEqual(partition(b[2],b),"test")
        with self.assertRaises(ValueError):
            partition(b[3],b)
        for val in (2,"-1","00",str(2**128)):
            with self.assertRaises(ValueError):
                raw_uint(val,128)

    def test_no_overwrite(self):
        self.swap()
        self.run_build()
        with self.assertRaisesRegex(ValueError,"OUTPUT_EXISTS"):
            self.run_build()


if __name__=="__main__":
    unittest.main()
