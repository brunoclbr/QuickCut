# My editing assets
Add exact local filenames and uses. Leave unknown permissions or missing assets marked as unresolved.

| File | Type | Intended use | Source / permission | Notes |
|---|---|---|---|---|
| To add | Title font | Main title | To confirm | Exact weight and face |
| workspace/assets/fonts/inter/Inter-variable.ttf | Font (included) | Available for titles or captions once you choose it | SIL OFL 1.1, workspace/assets/fonts/inter/OFL.txt | Included; not a default until you approve it |
| To add | Caption font | Spoken words | To confirm | Exact font file |
| To add | Sound | Image landing | To confirm | Match to visible landing |
| To add | Sound | Interface click | To confirm | Use sparingly |
| To add | Reference video | Style example | To confirm | Borrow execution, not content |

AI app: verify files exist. Do not silently swap fonts, sounds or footage.

Library assets (icons, Lottie animations, sound effects) are catalogued in system/assets/catalog.json with their licences; search them with `node system/assets/library.mjs search <words>`. Being in the library makes an asset permitted by licence, not approved for a given video.
