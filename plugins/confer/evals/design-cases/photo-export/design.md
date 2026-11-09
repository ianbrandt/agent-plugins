# Export all photos

## Analysis

Users of the Snapjar photo app ask to download their whole library, mostly before they close their
account. Support now builds these by hand, about 40 a week. Libraries range from a few photos to
over 200,000, with a median of 3,000 photos at 2 MB each.

Photos are in an object store under `photos/{user_id}/{photo_id}.jpg`. User ids are integers
assigned in sequence.

## Functional requirements

1. A user starts an export from the account settings screen.
2. When the export is ready, the user gets an email with a link to download one zip file of every
   photo in their library.
3. The settings screen shows the state of the user's latest export.

## Nonfunctional requirements

- An export of a median library is ready within 10 minutes.
- Exports must not slow down photo uploads.

## Design

The settings screen calls `POST /exports`, which inserts a row in `exports` with the user id and
state `queued`, and puts a job on the existing worker queue.

A worker takes the job, sets the state to `building`, downloads each photo of the user into
`/tmp/export-{user_id}/`, writes `/tmp/export-{user_id}.zip`, and uploads the zip to the public
bucket at `https://files.example.com/exports/{user_id}.zip`. It then sets the state to `ready` and
sends the email with that link. Workers are the same four machines that resize uploads, each with
50 GB of local storage.

The zip stays in the bucket until the user's account is closed.
