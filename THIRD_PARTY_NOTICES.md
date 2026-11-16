# Third-party notices

## Fly / fighter by Dash (@creativedash)

Airplanes includes a source snapshot and an adapted runtime of the Fly / fighter demonstration created by **Dash (@creativedash)** and shared through Forge.

- Original announcement: https://x.com/creativedash/status/2122000830895386680
- Original share: https://forge.ui8.ai/share/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24
- Original demo: https://fly.ui8.dev
- Forge documentation: https://ui8.ai/forge/docs
- Imported published revision: **35**, retrieved **2026-11-16**.

The author publicly allowed remixing and modification in the announcement replies. Forge's documentation describes bringing shared projects into one's own code and retaining source attribution. This is the provenance and permission basis for this migration; we have not located a standard MIT, Apache, or other OSI license covering the original demonstration, and do not represent the original code as licensed under one.

The upstream author retains their rights. Airplanes does not relicense the upstream snapshot or its derived renderer as original ForceMind work. See `docs/UPSTREAM.md` and `vendor/upstream/fly-v35/manifest.json` for source URLs, local adaptation details and SHA-256 hashes.

### Files covered by this notice

- `vendor/upstream/fly-v35/`: unchanged upstream source/page snapshots and provenance manifest.
- `src/engine/scene.js`, `src/engine/jet-model.js`, `src/engine/cockpit.js`, `src/engine/flame-layer.js`: locally importable adaptations of upstream code, with source headers. The scene adds an explicitly separated integration interface for Airplanes.

## Airplanes additions

The version portal, hangar, game integration, combat simulation, external actor bridge, procedural Spitfire and Bf 109 geometry, liveries, procedural audio, tests and project scripts were created for Airplanes. These additions do not reuse the upstream modern fighter geometry for the WWII aircraft.

Aircraft silhouettes, liveries and missions are stylized historical-inspired game content, not claims of exact aircraft or unit reconstruction. The original free-flight experience remains separately accessible.

## Development dependencies

Playwright is used for development and browser verification only. It is not shipped as a runtime dependency of the built game. Its upstream license and notices remain included in the installed package.

## Fighter + Guns v9 combat fork

The user-selected public build at https://2kp1v13.sharehtml.org/ is preserved byte-for-byte in `vendor/upstream/fighter-guns-v9/index.html`. Its title explicitly calls it a combat fork of Dash's jet game and retains attribution to Dash / @creativedash. We have not identified the combat-fork author's name or found a standard license covering this game's source. Public availability is not represented as a broad MIT/Apache redistribution grant. Obtain appropriate permission before commercial redistribution; Airplanes does not claim this combat implementation as its original work.

`modern/index.html` is a deterministically adapted local runtime. `scripts/import-modern.mjs` records its narrowly scoped camera hook, storage namespace, content-security policy and lifecycle bridge. Native gameplay, skill tree, achievements, save slots and camera implementation remain upstream code. Existing bundled React, react-dom and scheduler license notices are preserved in both snapshot and runtime. Their dependency licenses do not establish the license of the game itself.

The separately supplied Forge URL `https://forge.ui8.ai/share/frag_2a9b059a-aeb6-4aea-a447-668efb59bd3e` returned only the platform shell during acquisition. Its relationship to the ShareHTML build is unverified; no claim that this second project's source was imported is made.
