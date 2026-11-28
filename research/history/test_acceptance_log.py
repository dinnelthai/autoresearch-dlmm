import argparse
import json
import tempfile
import unittest
from pathlib import Path
from acceptance_log import event,inspect_logs,inspect_history,inspect_quality,export,dataset_report
from test_build_dataset import DatasetTests,POOL

class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root=Path(t.name)
    def test_stage_log_failed_and_interrupted(self):
        for run in ("a"*32,"b"*32):
            p=self.root/(run+".jsonl")
            event(p,run,"swaps","START",commit=None,secret="not exported")
            if run[0]=="a":
                event(p,run,"swaps","END",exitCode=1,elapsedMs=100)
        r=inspect_logs(self.root)
        self.assertEqual([x["status"] for x in r["runs"]],["EXIT_FAILED","NO_END_RECORD"])
        self.assertNotIn("secret",json.dumps(r))
    def test_missing_evidence_not_ready(self):
        o=self.root/"report.json"
        a=argparse.Namespace(pool=[POOL],history=self.root,logs=self.root,quality=[],dataset=None,output=o)
        self.assertEqual(export(a),0)
        r=json.loads(o.read_text())
        self.assertFalse(r["gpuReady"])
        self.assertEqual(r["datasetStatus"],"NOT_PROVIDED")
        self.assertEqual(r["historyArtifacts"],[])
    def test_archive_reports_distinct_counts(self):
        d=self.root/POOL/"snapshots"/"2026-11-01"
        d.mkdir(parents=True)
        (d/"manifest.json").write_text(json.dumps(dict(pool=POOL,day="2026-11-01",source="EXISTING_FINALIZED_ACCOUNT_CAPTURES",status="SCANNED_UNVERIFIED",coverage=dict(expectedBuckets=1440,observedBuckets=10,missingBuckets=1430,eligibleObservations=12),inspected=20,duplicates=8,conflictSlots=[],issues=[],bytes=100)))
        rows,errors=inspect_history(self.root,[POOL])
        self.assertEqual(rows[0]["coverage"]["eligibleObservations"],12)
        self.assertEqual(rows[0]["coverage"]["missingBuckets"],1430)
        self.assertEqual(errors,{})
    def test_dataset_rows_not_snapshot_count(self):
        fixture=DatasetTests()
        fixture.setUp()
        try:
            fixture.snapshot()
            fixture.swap()
            fixture.run_build()
            report=dataset_report(fixture.root/"out",[POOL])
            r=next(x for x in report["summary"] if x["kind"]=="bin_snapshots" and x["split"]=="train")
            self.assertEqual(r["rows"],70)
            self.assertEqual(r["sumDailyDistinctSlots"],1)
            self.assertEqual(r["sumDailyDistinctTimes"],1)
            self.assertFalse(report["exactReplayReady"])
        finally:
            fixture.doCleanups()
