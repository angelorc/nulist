---
'@nulist/web': patch
---

Saving a visual template with an image marked as decorative no longer reports "Attribute role is illegal": the image keeps its empty alt text, without the `role` attribute MJML does not accept on images.
