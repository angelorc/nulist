# @nulist/web

## 0.2.2

### Patch Changes

- [#18](https://github.com/angelorc/nulist/pull/18) [`6281288`](https://github.com/angelorc/nulist/commit/62812883107593f069061f76f23c03e2ac594565) Thanks [@angelorc](https://github.com/angelorc)! - Add contact closes the list menu after each pick, so the "Skip the confirmation email" switch is visible before submitting, and the lists help text says when a confirmation email is sent.

- [#17](https://github.com/angelorc/nulist/pull/17) [`279e033`](https://github.com/angelorc/nulist/commit/279e033c1ad59f99ea7ee20ab53cea9d15c029db) Thanks [@angelorc](https://github.com/angelorc)! - Recent imports on the contact import page line up with the wizard steps.

- [#22](https://github.com/angelorc/nulist/pull/22) [`54f0d60`](https://github.com/angelorc/nulist/commit/54f0d60058e853924a1c5d8110a9ef1321207a16) Thanks [@angelorc](https://github.com/angelorc)! - Record Amazon SES open and click events again: SES reports `isBotEvent` as `Likely` / `Unlikely` and sends `linkTags: null`, which the event schema rejected, so open and click rates stayed empty.

- [#21](https://github.com/angelorc/nulist/pull/21) [`04d6fb7`](https://github.com/angelorc/nulist/commit/04d6fb7fec107fdd9918f2c70fc04612b36d225b) Thanks [@angelorc](https://github.com/angelorc)! - The text and heading formatting toolbar in the visual editor stays inside the visible canvas: above the block when there is room, below it otherwise, pinned to the top of the canvas as a last resort, so smaller screens no longer need browser zoom to reach it.

## 0.2.1

### Patch Changes

- [#14](https://github.com/angelorc/nulist/pull/14) [`08eab93`](https://github.com/angelorc/nulist/commit/08eab9383549707c7b4ce767ac1be2a06ed74a29) Thanks [@angelorc](https://github.com/angelorc)! - Sign-in page shows the nulist logo, with a refreshed layout and a full-color Google button. The favicon.ico is regenerated from the brand mark.

## 0.2.0

### Minor Changes

- [#13](https://github.com/angelorc/nulist/pull/13) [`c3ad3e5`](https://github.com/angelorc/nulist/commit/c3ad3e5484a853bee442299ab317fdc5b041d10a) Thanks [@angelorc](https://github.com/angelorc)! - Sign in with Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); email and password only in development. New accounts need an invitation, and instance admins can restrict sign-in to email domains in Settings → Access.

- [#8](https://github.com/angelorc/nulist/pull/8) [`291b054`](https://github.com/angelorc/nulist/commit/291b0541cf871f4272382c20b10440ad9c0f47a8) Thanks [@angelorc](https://github.com/angelorc)! - Templatical visual editor with ready-made starters, saved colors and the Geist font; roomier sidebar groups.
