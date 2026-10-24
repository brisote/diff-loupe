# Website

The public site of Diffloupe at https://diffloupe.com. It is an Astro project with static output; `AGENTS.md` lists its commands and rules. It builds against the frozen site boards in the private design repository; see `AGENTS.md`.

The fonts in `public/fonts/` come from `scripts/make_fonts.py`, which needs fontTools and Brotli (`python3 -m pip install fonttools brotli`). It keeps Google Sans Flex's weight and optical-size axes and pins the others.

`src/assets/screens/` holds the screenshots of the app that the site and its design use: each scene in a light and a dark version at 2880 × 1800 pixels, and `manifest.json`, which lists every scene with its description and size. Use only these files for pictures of the app.

Regenerate them after a change to the app's UI:

```bash
python3 website/scripts/capture_screens.py
```

It builds the dev bridge and drives the real UI through `frontend/e2e/site-screens.spec.ts` on demo repositories, with fixed commit dates, UTC time and without your git settings, so every run gives the same files. It fails when a scene lacks a theme or has another size, and then leaves the folder as it was. It also fails when port 1421 is already in use, so the pictures always come from this checkout. To add a scene, add a test to that spec that calls `shoot()` with a name and a description.
