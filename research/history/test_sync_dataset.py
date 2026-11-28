import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from sync_dataset import sync,verify

POOL="A"*32
REL=f"swaps/train/{POOL}/2026-11-01/000000-000000.parquet"

class SyncTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        self.src=self.root/"src"
        self.dst=self.root/"dst"
        p=self.src/REL
        p.parent.mkdir(parents=True)
        p.write_bytes(b"fixture bytes")
        self.manifest=dict(schemaVersion=1,status="OBSERVED_RESEARCH_DATA_UNVERIFIED",pools=[POOL],boundariesUtc=dict(start="2026-11-01",validationStart="2026-11-02",testStart="2026-11-03",end="2026-11-04"),counts={"swaps/train":1},files=[dict(path=REL,rows=1,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),kind="swaps",split="train",pool=POOL,day="2026-11-01")],historyComplete=False,exactReplayReady=False,calibrated=False,profitabilityEvidence=False)
        self.write()
    def write(self):
        (self.src/"manifest.json").write_text(json.dumps(self.manifest))
    def test_copy_and_reuse_only_manifest_files(self):
        (self.src/".env").write_text("never copy")
        self.assertEqual(sync(self.src,self.dst)["copied"],1)
        self.assertEqual(sync(self.src,self.dst)["reused"],1)
        self.assertFalse((self.dst/".env").exists())
        self.assertFalse(verify(self.dst)["exactReplayReady"])
    def test_resume(self):
        p=self.dst/REL
        p.parent.mkdir(parents=True)
        p.write_bytes((self.src/REL).read_bytes())
        (self.dst/".pending-manifest.json").write_bytes((self.src/"manifest.json").read_bytes())
        self.assertEqual(sync(self.src,self.dst)["reused"],1)
        self.assertTrue((self.dst/"manifest.json").exists())
    def test_source_corruption(self):
        (self.src/REL).write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError,"DATASET_HASH_MISMATCH"):
            sync(self.src,self.dst)
        self.assertFalse(self.dst.exists())
    def test_committed_destination_corruption(self):
        sync(self.src,self.dst)
        (self.dst/REL).write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError,"DATASET_HASH_MISMATCH"):
            sync(self.src,self.dst)
    def test_path_traversal(self):
        self.manifest["files"][0]["path"]="../.env"
        self.write()
        with self.assertRaisesRegex(ValueError,"FILE_PATH"):
            sync(self.src,self.dst)
    def test_conflicting_manifest(self):
        sync(self.src,self.dst)
        self.manifest["extra"]="new identity"
        self.write()
        with self.assertRaisesRegex(ValueError,"DESTINATION_MANIFEST_CONFLICT"):
            sync(self.src,self.dst)
    def test_wrong_partition(self):
        self.manifest["files"][0]["split"]="test"
        self.write()
        with self.assertRaisesRegex(ValueError,"PARTITION_IDENTITY"):
            verify(self.src)
    def test_symlink(self):
        p=self.src/REL
        other=self.root/"other"
        p.rename(other)
        p.symlink_to(other)
        with self.assertRaisesRegex(ValueError,"SYMLINK_FORBIDDEN"):
            verify(self.src)
