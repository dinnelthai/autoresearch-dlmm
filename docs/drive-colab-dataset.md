# H07: Drive filesystem transfer and verified Colab reader
No new service, OAuth token storage, Drive API, or automatic upload. H06 dataset is the only allowed payload. A Google Drive for desktop mounted/synced folder is sufficient on Mac; Colab uses its normal Drive mount. The script copies explicitly listed Parquet files and the manifest, never scans/copies .env, wallets, raw captures or the rest of the repository. Keep original raw evidence separately.

## Local
```sh
# Set this to the actual My Drive directory shown by Finder; example only.
DRIVE="$HOME/Library/CloudStorage/GoogleDrive-YOUR_ACCOUNT/My Drive"
python research/history/sync_dataset.py verify data/historical/datasets/study-001
python research/history/sync_dataset.py sync data/historical/datasets/study-001 "$DRIVE/dlmm-research/datasets/study-001"
```
Check Drive desktop sync completion. The script verifies local mounted filesystem bytes, not remote upload completion. Colab independently verifies all files after Drive propagation. A failed sync may leave a pending marker and copied files; rerun same source and destination to resume. Same hash files are reused. Different manifest at destination is rejected; use new dataset ID for every frozen version. Completed corrupt destination is rejected, not overwritten. Remove stale lock only after confirming no active transfer. Do not run overlapping writers, modify source mid-copy, or change files while a reader runs. No cross-version global deduplication. No claim of server-side transactional publication: manifest may propagate before data, in which case reader rejects until all files arrive.

## Colab
Open research/history/colab-reader.ipynb from the branch in Colab, select CPU runtime, mount Drive, enter the dataset ID, run sync to local runtime disk (faster reads). Ensure enough temporary disk capacity; choose a smaller immutable dataset if required. If PyArrow is absent install it before reading. The notebook displays the checked-out commit; pin an exact commit for reproducible experiments. Reader requires an explicit kind and split, checks file hashes/schema/row counts and yields bounded Arrow record batches; uint64/128 remain strings. No join between block-time swaps and receipt-time snapshots. H08 will use training only for model fitting and require a separate availability-time contract, sufficient coverage, and CPU/GPU parity.

## Result return
Use a separate Drive directory dlmm-research/results/<experiment-id>/ for H08 reports. Do not append results to frozen dataset manifests. The notebook currently only reads datasets; result generation/return is deferred to H08. Actual Drive upload/download, account capacity, Colab disk and throughput not tested here. CI tests exercise local filesystem copy/resume, digest mismatch, manifest conflict, path allowlist, partition checks; filesystem tests do not prove cloud sync or data authenticity.
