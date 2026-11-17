# @nulist/sdk

## 0.5.0

### Minor Changes

- [#30](https://github.com/angelorc/nulist/pull/30) [`69a10df`](https://github.com/angelorc/nulist/commit/69a10dfee4a3884c283f8388350660031b926093) Thanks [@angelorc](https://github.com/angelorc)! - Segments can group conditions (all, any or none of), target email activity (sent, delivered, opened, clicked, bounced, complained or unsubscribed, optionally for one broadcast, a transactional template or tag, a link, at least N times within a window), include or exclude other segments and match topic subscriptions, and start from presets such as engaged, unengaged or never opened. Contact pages list the segments a contact belongs to, and broadcasts can exclude segments as well as lists. The REST API and the SDK gain read-only segments (`segments.list`, `segments.get`, `segments.listContacts`), and broadcast audiences accept `excludeSegmentIds`. Segment membership is now synced every few minutes, so segment pages show members, who entered or left this week and a history of changes, contact pages show since when a contact belongs to each segment, and webhooks can subscribe to the new `segment.entered` and `segment.exited` events. Webhooks are now delivered in batches per endpoint, and deleting a contact sends `segment.exited` for every segment it belonged to.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.2

No changes in this release.

## 0.2.1

No changes in this release.

## 0.2.0

No changes in this release.
