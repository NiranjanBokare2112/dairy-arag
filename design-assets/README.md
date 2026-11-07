# Design assets — आरग दूध संकलन केंद्र

Source of truth for all visuals in the app, bills, receipts, letterhead and messages.

## Files

| Folder | File | Use |
|---|---|---|
| `logo/` | `arag-logo-badge.html` / `.png` | Main round logo (transparent PNG). App splash, login, WhatsApp profile picture, stamp. |
| `logo/` | `arag-logo-horizontal.html` / `.png` | Horizontal logo (transparent PNG). App header, bill header, signboard. |
| `letterhead/` | `arag-letterhead-a4.html` / `.png` | A4 letterhead. HTML has Print (A4) and PNG export buttons. |
| `bill/` | `arag-bill-sample-a4.html` / `.png` | Farmer milk bill design, A4, with sample data. Reference for the PDF bill template. |
| `images/` | `arag-cow-calf-transparent.png` | Cow and calf only, background removed (797×590). Icons, splash, empty states. |
| `images/` | `arag-farm-scene.jpg` | Cowshed scene used at the bottom of the letterhead (1600 px wide). |

The PNGs in this folder were rendered without the Mukta font, so their Marathi text uses a fallback font. For final PNGs, open the HTML file in Chrome (internet needed for the font) and click **"PNG डाउनलोड करा"** (3× resolution).

## Colors

| Token | Hex | Use |
|---|---|---|
| `primary` | `#1F4E9A` | Brand blue: logo ring, headings, table headers, footer bar, primary buttons |
| `primary-dark` | `#163A73` | Hover/pressed |
| `green` | `#2E7D32` | Tagline, accent rule, success, net payable |
| `green-dark` | `#1B5E20` | Net payable amount text |
| `green-tint` | `#E8F3E9` | Net payable highlight background |
| `grass` | `#8FAD3E` | Ground in the logo |
| `sky` | `#E3EFF8` | Logo inner circle, totals row |
| `info-bg` | `#EEF4FB` | Info panels |
| `border` | `#C9D6E8` | Table/card borders |
| `text` | `#1A1A1A` | Body text |
| `text-muted` | `#555555` | Labels (keep ≥ #767676 contrast on white) |
| `danger` | `#C62828` | Errors, "नमुना" sample tag |

## Typography

- Font: **Mukta** (Google Fonts), weights 400, 500, 600, 700, 800. Supports Marathi (Devanagari) and English.
- Never add letter-spacing to Marathi text (it breaks the शिरोरेखा).
- Name lockup: "आरग दूध संकलन केंद्र", weight 800, primary blue.
- Tagline: **शुद्धता • पारदर्शकता • विश्वास**, weight 600, green (on white) or white (on blue).

## Center details

- आरग दूध संकलन केंद्र
- मु. पो. आरग, ता. मिरज, जि. सांगली – ४१६४०१
- मो. ९१५८४३५३०४
