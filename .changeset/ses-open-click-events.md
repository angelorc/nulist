---
'@nulist/web': patch
---

Record Amazon SES open and click events again: SES reports `isBotEvent` as `Likely` / `Unlikely` and sends `linkTags: null`, which the event schema rejected, so open and click rates stayed empty.
