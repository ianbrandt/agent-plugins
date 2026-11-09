# Move attachments to object storage

## Analysis

The invoicing app stores files that customers attach to invoices on an NFS volume mounted on all
eight web servers, at `/mnt/attachments/{invoice_id}/{file_name}`. The volume holds 1.8 million
files, 2.1 TB in all, and is 91% full. The storage team retires the NFS server at the end of next
quarter.

The `attachments` table has one row per file, with the invoice id, the file name, the size, and an
MD5 of the content, written at upload.

## Design

A second implementation of `AttachmentStore` is added for the bucket `invoice-attachments`, with
keys `{invoice_id}/{file_name}`. Which store is used depends on two flags:

- `attachments_dual_write` writes each upload to the volume and then to the bucket. An upload
  succeeds only when both writes succeed.
- `attachments_read_bucket` serves downloads from the bucket instead of the volume.

## Rollout

Each step starts after the one before it is done.

1. Deploy the release with the bucket store and both flags off.
   Done when: the release is on all eight servers and the upload error rate is unchanged.
   Rollback: redeploy the previous release.
2. Turn on `attachments_dual_write`.
   Done when: for one day, every new row in `attachments` has an object in the bucket, per the
   hourly `attachments-sync` report.
   Rollback: turn the flag off.
3. Run `copy-attachments`, a one-time job that reads the rows of `attachments` and copies each file
   from the volume to the bucket, skipping keys that are already there. At 200 files a second it
   takes about three hours.
   Done when: the job has finished.
   Rollback: none needed, since the job only adds objects.
4. Turn on `attachments_read_bucket`.
   Done when: download errors stay under 0.1% for two days.
   Rollback: turn the flag off.
5. Unmount the volume from the web servers and return it to the storage team, which keeps a
   snapshot for 30 days.
   Done when: no server has the volume mounted.
   Rollback: mount the volume again.
6. Deploy a release with the volume store and both flags removed, so that uploads go to the bucket
   only.
   Done when: the release is on all eight servers.
   Rollback: redeploy the previous release.
