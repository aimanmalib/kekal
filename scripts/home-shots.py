#!/usr/bin/env python3
"""Home page "How it works" images: crops of the WebKit iPhone 13 screenshots the e2e run saves, as AVIF and WebP.

Take the screenshots on the public site (devnet), so no local address shows. Inside e2e/, through the shared browser
queue, with a devnet test shop key (not a role key) in <keys>/test-wallet.json:
  E2E_BASE_URL=<site> E2E_KEYS=<keys> E2E_WALLET_CHAIN=solana:devnet E2E_HOME_SHOTS=1 E2E_SHOTS=<dir>/shots \
    npx playwright test tests/home-shots-live.spec.ts --project=webkit-iphone13
  E2E_BASE_URL=<site> E2E_SHOTS=<dir>/shots npx playwright test tests/demo.spec.ts --project=webkit-iphone13
then sort them: <dir>/en gets the *-en-* files, <dir>/ms the *-ms-* and *-demo-* files.
then: python3 scripts/home-shots.py <dir>   (needs Pillow with AVIF and WebP support)

Each crop is one phone screen (390 x 780 CSS px) starting at the CSS pixel offset below. Offsets depend on the page
layout: re-check them by eye after a layout change, then commit the images with the change.
"""
import sys
from pathlib import Path

from PIL import Image

SCALE = 3  # iPhone 13 device pixel ratio
WIDTH, HEIGHT = 390, 780  # CSS px of one crop
OUT_SCALE = 2  # stored at 2x for sharp phones and laptops
# step-lang: (screenshot, top of the crop in CSS px). shop-ms sits lower: by the second run the test shop board
# lists the open claim from the first one above "Issue a card".
CROPS = {
    "shop-en": ("en/e2e-webkit-iphone13-en-kedai-issued.png", 1325),
    "shop-ms": ("ms/e2e-webkit-iphone13-ms-kedai-issued.png", 1622),
    "card-en": ("en/e2e-webkit-iphone13-en-buyer-claimed.png", 92),
    "card-ms": ("ms/e2e-webkit-iphone13-ms-buyer-claimed.png", 92),
    "paid-en": ("ms/e2e-webkit-iphone13-demo-silent-paid.png", 800),
    "paid-ms": ("ms/e2e-webkit-iphone13-demo-closed-paid.png", 1215),
}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    shots = Path(sys.argv[1])
    only = set(sys.argv[2:])
    out = Path(__file__).resolve().parent.parent / "apps/web/src/media/how"
    out.mkdir(parents=True, exist_ok=True)
    for name, (file, top) in CROPS.items():
        if only and name not in only:
            continue
        image = Image.open(shots / file).convert("RGB")
        box = (0, top * SCALE, WIDTH * SCALE, (top + HEIGHT) * SCALE)
        crop = image.crop(box).resize((WIDTH * OUT_SCALE, HEIGHT * OUT_SCALE), Image.Resampling.LANCZOS)
        crop.save(out / f"{name}.avif", quality=55)
        crop.save(out / f"{name}.webp", quality=78, method=6)
        print(name, (out / f"{name}.avif").stat().st_size, (out / f"{name}.webp").stat().st_size)


if __name__ == "__main__":
    main()
