# Visual assets and texture sources

The texture images are included locally to avoid external requests during rendering. All celestial bodies have been restored to the imagery and procedural materials used before the generated 16K enhancement. Earth retains its original native 16K observation mosaic. Local ground now uses one closed sphere with concentrated subdivision near the observer, without AI enhancement tiles or a separate ground overlay. Credit and ownership of the imagery remain with their respective creators; no exclusive ownership of third-party imagery is claimed.

The website posters `public/site/earth.png`, `mars.png`, and `saturn.png` are original 900 × 900 transparent screenshots of this application's planet renderer using the textures listed below. They retain the underlying imagery credits and applicable licenses; they are not additional stock imagery. The site background uses the same `milky-way-4k.jpg` panorama. The deployed website includes this document and `THIRD_PARTY_NOTICES.md` under `legal/`.

## Echo Rift — original fictional system

The six Echo Rift bodies are original procedural artwork implemented in `src/echo-models.ts` and `src/echo-surface.ts`. The pulsar has a deliberately enlarged 18,000 km visual radius, blue-white plasma, a soft corona and two tilted beams. Veyl has teal and gold atmospheric bands and a spiral storm. Ruin and Shard use separated, closed radial rock wedges, luminous cut faces and instanced debris; their navigation radii describe the conservative debris envelope. No astronomical photographs are claimed for these bodies, and their distances, orbits, atmosphere, gravity and water-heating premise are fictional.

Thalassa and Cinder each use a deterministic **512 × 256** field in `shared/echo-terrain.mjs`. The same field drives orbital colour, local surface colour, landing and walking collision; Thalassa includes a separate water mask for seas and low branching channels. Fine colour structure is procedural and does not represent measured relief. This adds two solid worlds to the 34 existing terrain definitions. The six bodies add no downloaded planet textures.

Echo Rift's background retains the licensed 8K/4K Milky Way panorama credited below. `src/galaxy-sky.ts` applies a continuous spherical warp and a fixed cold cyan/violet dust network with an independent star seed. This is an artistic rearrangement of that panorama, with its existing attribution and licence retained, rather than a newly observed sky or an additional source image.

## Retired 16K enhancement — historical provenance

The following section records the removed enhancement and its source credits. Its AI material atlas and generated tiles are no longer used by the game.

The current navigation includes **43 celestial bodies and one space station**. On non-compact desktop devices in high or ultra quality, close views of bodies other than Earth use a **16384 × 8192** detail domain divided into eight columns and four rows. Generation begins within three body radii of the centre, with a GPU texture limit of at least 2064 pixels. Each generated tile has a **2048 × 2048** interior with an eight-pixel gutter on each edge, for a **2064 × 2064** texture; at most four tiles are resident for the active body. The GPU combines the original global map with finer rock, ice, cloud or stellar material detail, with separate seeds and morphology for each body. Cached tiles and their filtered direct fallback evaluate the same body-fixed material. Orbital models, the local horizon and detailed ground retain the same imagery and UV frame; entering the surface scene does not replace them with a different ground texture. Earth keeps its native 16K tile path in ultra quality. The game does not allocate 43 complete 16K textures.

Earth's day-map tiles remain crops of native NASA 16K imagery. Their 2064-pixel upload limit is independent of the optional 8K global layers: native detail can stream over the 4K base if those layers are unavailable or exceed the GPU limit. The other bodies use **enhanced 16K** output: where measured or concept source maps exist, they remain 2K, 4K or 8K, and the added microstructure is generated artwork. Ceres retains an original procedural base. The material atlas is AI-generated; fine rock textures, ice fractures, cloud filaments and plasma granules are illustrative detail rather than new measured craters, weather or stellar observations. The original maps still determine the large-scale colours and geography. This is additional material structure, rather than an enlarged image alone; output resolution and measured source resolution are recorded separately.

`public/textures/surface-material-atlas.jpg` is an original **1254 × 1254** image generated for this project with built-in OpenAI image generation on 2026-10-07. Its four **627 × 627** quadrants provide rock, ice, gas and stellar microdetail references. The source PNG was encoded as JPEG quality 85 without resizing; the delivered file is **514,527 bytes**. The atlas is artistic concept material, not a measured height map or astronomical photograph, and no separate CC licence is claimed. Its source SHA-256 (`7c6a63713cec01cb634879ae88afa14438b3846c9c381d89760ea1a7c751fe9b`) and delivery SHA-256 (`cc727d6c8ef25fe92642fcc7fd832f626981b68faf75f64e6c9d0fdc62f9dc67`), dimensions and encoding are recorded in `public/textures/provenance.json`. The compact atlas is sampled together with spherical procedural structure to produce the 16K tiles; it is not a native 16K photographed map.

The coverage includes the Sun, eight planets, 26 moons, three Alpha Centauri/Proxima stars, three Proxima planets, Betelgeuse and Ceres. Bodies without global photographs retain their concept-art status. The space station uses its own hull, truss and solar-wing geometry and materials. Compact devices retain the lighter source-map paths and the same geographical frame; an unavailable optional detail cache leaves the complete global map usable. Enhancement does not change the imagery's date or turn concept maps into photographs.

## One physical terrain from orbit to walking

`shared/terrain-fields.mjs` contains **38 solid-body definitions and 33 shared raster sources** generated by `python scripts/prepare-canonical-terrain.py` (build-time NumPy and Pillow). Earth has a **1024 × 512** byte elevation field derived from the shipped GEBCO 08 map, plus a separate water mask that distinguishes sea-level land from water. Other bodies have **512 × 256** fields: their existing measured/concept images provide illustrative luminance relief; Ceres and Venus's rocky surface use fixed procedural crater fields. Mimas's visible Herschel bowl is anchored to its position in the shipped image, with an illustrative depression and rim. Those non-Earth fields are artistic relief, not measured digital elevation models. Image-derived fields retain the original imagery's credits and licences listed in this document.

Orbital displacement and normals, curved local ground, ship landing and walking collision sample the same field in the same body-fixed frame, including axial tilt, initial surface yaw and any concept-map longitude offset. Non-Earth metre-scale roughness also uses the same CPU/GPU function. Colour resolution and height resolution remain distinct: the 16K material does not imply 16K measured elevation. Quality and distance change filtering, cache residency and mesh density without moving geographical features. Valid older landed/walking saves are checked against the legacy terrain before their anchors are moved onto terrain version 2; surface direction and height above ground are preserved.

## Earth ultra: native 16K geography and 8K supporting layers

The current Earth maps replace the former 4K imagery from three-globe and webgl-earth. Historical notices remain for the preserved earlier offline packages.

| Local files | Delivered resolution | Source |
| --- | --- | --- |
| `earth-day.jpg`, `earth-day-8k.jpg` | 4096 × 2048 / 8192 × 4096 | NASA Earth Observatory Blue Marble Next Generation, September 2004, without baked relief or bathymetry |
| `earth-detail-C-R.jpg` (32 tiles) | Native 16384 × 8192 mosaic; 2048² tile interiors plus 8-pixel gutters | The same native 16K Blue Marble mosaic, cropped without upscaling |
| `earth-clouds-4k.jpg`, `earth-clouds-8k.jpg` | 4096 × 2048 / 8192 × 4096 | NASA MODIS Blue Marble cloud-density composite |
| `earth-night.jpg`, `earth-night-8k.jpg` | 4096 × 2048 / 8192 × 4096 | NASA VIIRS Black Marble 2016 night radiance |
| `earth-terrain-4k.png`, `earth-terrain-8k.png` | 4096 × 2048 / 8192 × 4096 | Preserved source/provenance: GEBCO 08 elevation and NASA Blue Marble lake/coast classification; water = 0, land = 40 + encoded elevation |

Retrieved on 2026-10-04 from the public [orbital-botany imagery mirror](https://github.com/simon23-12/orbital-botany/tree/c92393f8be6b94f3684399f18e55790c91a8fdb4/assets/earth), pinned to `c92393f8be6b94f3684399f18e55790c91a8fdb4`. Its [source record](https://github.com/simon23-12/orbital-botany/blob/c92393f8be6b94f3684399f18e55790c91a8fdb4/assets/earth/HERKUNFT.md) and preparation script identify the NASA/GEBCO originals: [Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble), [MODIS clouds](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds), [Black Marble](https://earthobservatory.nasa.gov/features/NightLights), and [GEBCO topography](https://visibleearth.nasa.gov/images/73934/topography). NASA imagery is public domain; GEBCO data is freely usable. No upstream application code is included. Source and delivered dimensions, changes, and SHA-256 hashes are recorded in `public/textures/provenance.json`.

Rebuild the original images with `python scripts/prepare-earth-ultra.py <source-directory>` after downloading `day_09_16k.jpg`, `clouds_8k.jpg`, `night_8k.jpg`, and `terrain_8k.png` from that pinned mirror, then regenerate the shared terrain fields. The two original terrain PNGs remain in the repository and provenance record; runtime uses the shared field instead, and the current offline ZIP excludes the unused PNGs. Four bordered day-map tiles are resident at a time in ultra quality near Earth and remain usable on the local ground. Longitude gutters wrap and latitude gutters clamp. Full-world 8K day, cloud and night imagery loads progressively on capable desktop devices; touch/low-memory devices and GPUs below the required texture limit use 4K. Optional detail failures retain the complete global map.

The desktop Earth sphere uses 512 × 256 segments (compact 256 × 128), with the shared elevation displacement and slope normals, ocean Fresnel reflection and moving cloud shadows. Local ground retains the same day imagery, elevation and sea/land classification. Extra cloud detail is artistic rendering, not additional surveyed geography. The 8K night map preserves the delivered image resolution; the underlying night-light observations have a coarser spatial resolution. Day, cloud and night maps come from different dates and are not live imagery.

## Barnard's star and four close-orbit planets

`barnard-star-8k.jpg` and `barnard-{d,b,c,e}-8k.jpg` are original **8192 × 4096** spherical illustrations, evaluated directly at native resolution by `scripts/generate-barnard-textures.py`. Their `-4k.jpg` alternates are filtered **4096 × 2048** versions for compact devices. These original assets are released under **CC0-1.0**; per-file source/delivery dimensions and SHA-256 checksums are in `public/textures/provenance.json`. They contain generated spherical granulation, cool stellar spots, mineral fields and rocky crater structure. They are artistic concepts, not telescope photographs, surveyed mineral maps or measured elevation. No atmospheric clouds, oceans or lava observations are implied.

The models reuse the existing texture loader, sphere geometry, filtered shader detail and quality budgets. Barnard's warm stellar illuminant is shared between orbital and local terrain views, with a dim night-side floor; the star has a restrained corona and limb darkening. The four rocky worlds use the same body-fixed image-derived illustrative height fields for rendering, landing and walking collision. Their art does not change the existing measured solar-system maps or licences. The Milky Way uses the existing shared 8K/4K panorama.

The system contains the four confirmed short-period planets **d, b, c and e**, using [Basant et al. (2025), Table 3](https://arxiv.org/html/2503.08095v1): periods **2.3402, 3.1542, 4.1244, 6.7392 days**, semimajor axes **0.0188, 0.0229, 0.0274, 0.0381 AU**, and minimum masses **0.263, 0.299, 0.335, 0.193 Earth masses**. The masses are radial-velocity *m sin i*, not measured true masses. The stellar temperature **3195 K**, radius **0.185 solar radii** and distance **1.82823 pc** follow [González Hernández et al. (2024), Table 2](https://www.eso.org/public/archives/releases/sciencepapers/eso2414/eso2414a.pdf). [NASA's 2025 discovery summary](https://science.nasa.gov/universe/exoplanets/discovery-alert-four-little-planets-one-big-step/) confirms the four-planet system and places these orbits inside the habitable zone's inner boundary.

Planet radii **4400, 4650, 4800 and 4050 km**, terrain, spin, orbital inclinations/phases and surface gravities are gameplay concepts; atmospheric properties and resolved surfaces remain unknown. No old 233-day candidate is included. The arrangement retains the existing static orbit framework rather than calculating an ephemeris or adding orbital dynamics.

## Native 8K Mars and Moon surfaces

Mars and the Moon use native **8192 × 4096** Solar System Scope surface mosaics on capable desktop devices. `mars-real-8k.jpg` and `moon-real-8k.jpg` preserve the pinned sources' native pixel dimensions without enlargement; JPEG re-encoding at quality 90 keeps the downloadable game package compact. The existing **4096 × 2048** `mars-real.jpg` and `moon-real.jpg` remain as compact alternates for touch/low-memory devices and GPUs below the 8192-pixel texture limit, and provide a fallback if the 8K download fails. These maps load when the body is observed or approached and use the bounded surface-map cache. Orbital and local views share the same imagery; their image-derived illustrative relief also supplies landing collision.

Both originals come from the same fixed [renoultdavid/textures revision](https://github.com/renoultdavid/textures/tree/68b6d34056efb1065207f0b5e139d5998cc0a575) already used for the 4K versions: [`Mars.jpg`](https://github.com/renoultdavid/textures/blob/68b6d34056efb1065207f0b5e139d5998cc0a575/Mars.jpg) and [`lune.jpg`](https://github.com/renoultdavid/textures/blob/68b6d34056efb1065207f0b5e139d5998cc0a575/lune.jpg). Solar System Scope's [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) credit and licence apply to both resolutions. Retrieved and source SHA-256 verified on 2026-10-07; dimensions, encoding changes and separate source/delivery hashes are recorded in `public/textures/provenance.json`.

Rebuild only these native assets with `python3 scripts/prepare-body-textures.py /tmp/voyager-texture-sources mars-real-8k.jpg moon-real-8k.jpg`. Additional filename arguments select outputs; omitting them rebuilds all body textures. The preparation script verifies each pinned checksum and requires a native 8192 × 4096 source for these two files.

## Native 8K Milky Way sky

The game now directly samples the unchanged **8192 × 4096** Solar System Scope Milky Way panorama (`milky-way-8k.jpg`) on an unlit sky shell. This preserves native dust lanes and star-cloud detail instead of converting the panorama into a lower-resolution cube map. The source is the same licensed panorama previously delivered at 4K; **no 16K/32K photograph or upscaled source is claimed**. A restrained photographic shadow lift and circular analytic star points add display detail at the current screen resolution. Those extra points are original rendering artwork, not an astrometric catalogue or additional observed sky data.

All stellar systems share the same astronomical panorama with their own sky orientations and brightness. The Sun, Alpha Centauri and Proxima are close enough that a different blue-violet fictional galaxy is not appropriate to this presentation. The old `centauri-milky-way-4k.jpg` original artwork remains in the asset archive and earlier downloadable versions, but is no longer the current game background. The native 8K asset is used by capable hardware-rendered desktop devices; touch/low-memory devices, software renderers and GPUs below an 8192-pixel texture limit use the existing **4096 × 2048** downsample. Both paths use direct panorama sampling and smoothly fade with atmospheric optical density.

The 8K JPEG is byte-identical to the pinned [Whitebee7/solarsystem source](https://github.com/Whitebee7/solarsystem/blob/235e72c02e825e0c8d0792ec0aa6be43e1a14f68/textures/8k_stars_milky_way.jpg), credited to Solar System Scope under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retrieved and SHA-256 verified on 2026-10-05. Rebuild with `python3 scripts/prepare-galaxy-ultra.py` (Python and Pillow); source and delivery hashes are in `public/textures/provenance.json`. The panorama is astronomical artwork, not a current scientific sky survey or a navigable three-dimensional reconstruction of the Galaxy.

## Stage 04: Milky Way and planetary imagery (historical)

The Milky Way is delivered at **4096 × 2048**, downsampled from an **8192 × 4096** original. It is a sky panorama, not a navigable three-dimensional reconstruction of the Galaxy. It retains its original artwork and astronomical appearance; it is not represented as a current scientific sky survey.

| Local file | Size | Source and credit | License / changes |
| --- | --- | --- | --- |
| `milky-way-4k.jpg` | 4096 × 2048 | Solar System Scope, `textures/8k_stars_milky_way.jpg` in [Whitebee7/solarsystem](https://github.com/Whitebee7/solarsystem) | CC BY 4.0; resized from 8K, JPEG quality 92 |
| `mercury-real.jpg` (stage 04, replaced in stage 06) | 2048 × 1024 | Solar System Scope, `static/textures/2k_mercury.jpg` in [yamansdev/three.js-solar-system](https://github.com/yamansdev/three.js-solar-system) | CC BY 4.0; unchanged |
| `mars-real.jpg` (stage 04, replaced in stage 06) | 2048 × 1024 | Solar System Scope, `static/textures/2k_mars.jpg`, same source | CC BY 4.0; unchanged |
| `jupiter-real.jpg` | 4096 × 2048 | Askaniy Anpilogov; NASA/JPL-Caltech/SSI/SWRI/MSSS/ASI/INAF/JIRAM; Björn Jónsson, [CelestiaContent](https://github.com/CelestiaProject/CelestiaContent), `textures/hires/jupiter.jpg` | CC BY 3.0; JPEG re-encoded at quality 92 |
| `saturn-real.jpg` | 4096 × 2048 | Askaniy Anpilogov; NASA/JPL-Caltech; Björn Jónsson, CelestiaContent, `textures/hires/saturn.jpg` | CC BY 3.0; unchanged |
| `neptune-real.jpg` | 4096 × 2048 | Askaniy Anpilogov; NASA/JPL-Caltech; Björn Jónsson; Karkoschka, E. (1994), CelestiaContent, `textures/hires/neptune.jpg` | CC BY 3.0; unchanged |
| `venus-real.jpg` (stage 04, replaced in stage 06) | 512 × 256 | Oleg Pluton (Helleformer), [Stellarium](https://github.com/Stellarium/stellarium), `textures/venus.png` | CC BY 4.0; converted to JPEG |
| `uranus-real.jpg` (stage 04, replaced in stage 06) | 512 × 256 | Oleg Pluton (Helleformer), Stellarium, `textures/uranus.png` | CC BY 4.0; converted to JPEG |
| `sun-real.jpg` | 4096 × 2048 | Ruslan Kabatsayev; NASA/SDO HMI, Stellarium, `textures/sun.webp` | CC BY-SA 4.0; resized from 8K and converted to JPEG; this adapted image retains CC BY-SA 4.0 |

Retrieved on 2026-10-02 through normal HTTPS Git access. Source revisions:

- Whitebee7/solarsystem: `235e72c02e825e0c8d0792ec0aa6be43e1a14f68`; its `LICENSE-textures.md` identifies Solar System Scope's [CC BY 4.0 texture license](https://www.solarsystemscope.com/textures/).
- yamansdev/three.js-solar-system: `1a73e2921da8a7d8659ed159592932f8ce7a1d67`; its panorama is byte-identical to the licensed mirror above.
- CelestiaProject/CelestiaContent: `3ed5836133901114a9cb4a2ea35751b274a464a1`; each of the three included maps has an individual `.license` file with the credits and CC BY 3.0 identifier. The noncommercial Uranus map from this repository is not included.
- Stellarium/stellarium: `f57342271c6047774f3b25991ba494600301c709`; `CREDITS.md` sections 4.3c and 4.3o specify the Venus/Uranus and Sun map credits and licenses.

Exact source URLs, changes, pixel dimensions, original SHA-256 checksums and delivered SHA-256 checksums are recorded in [public/textures/provenance.json](public/textures/provenance.json). Stage 06 below replaces the stage 04 Mercury, Mars, Venus and Uranus maps.

License links: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Attribution and these links accompany the standalone package in this file and `THIRD_PARTY_NOTICES.md`. Original authors do not endorse this game.

## Generated geometry and rendering

The seeded 128 × 128 terrain grain/bump texture is generated locally from original code; no additional downloaded assets are used. Atmospheric shells, Saturn's rings and analytic shadows, solar prominences, spacecraft geometry, UI, and warp tunnel effects are original generated geometry/shaders. Venus's cloud switch reveals a procedural illustration of its normally obscured surface. Cloud motion, exposure, and illumination are simplified; maps combine observations/artwork from different dates and are not live imagery.

Flight uses real mean radii and mean Sun distances in kilometres, with double-precision positions and a floating render origin. Planetary directions are a fixed illustrative layout, not an ephemeris. The observer fits each individual body into its own view. Propulsion, shields and faster-than-light travel are fictional gameplay; near-surface gravity is simplified and full orbit integration is not implemented.

## Stage 06: high-resolution maps for every body

Image-backed planets, moons, stars and exoplanets have equirectangular source maps; Ceres retains its independent procedural base. **Observed** maps are global mosaics built from spacecraft or telescope imagery of that body. **Concept** maps are openly licensed artwork used where no global imagery exists (Neptune's small inner moons, Nereid) or for bodies that have never been imaged (the Alpha Centauri stars and Proxima's planets); they are tinted and offset per body and are not presented as photographs. Earth was subsequently upgraded to native 16K/8K NASA and GEBCO maps; see the Earth ultra section above.

| Local file | Used for | Size | Kind | Credit | License |
| --- | --- | --- | --- | --- | --- |
| `mercury-real.jpg` | Mercury | 4096 × 2048 | observed | Solar System Scope (8k_mercury.jpg downscaled to 4096 px by the mirror) | CC BY 4.0 |
| `venus-real.jpg` | Venus cloud tops | 4096 × 2048 | observed | Solar System Scope (4k_venus_atmosphere.jpg) | CC BY 4.0 |
| `mars-real.jpg`, `mars-real-8k.jpg` | Mars | 4096 × 2048 / 8192 × 4096 | observed | Solar System Scope (8k_mars.jpg, byte-identical upstream) | CC BY 4.0 |
| `uranus-real.jpg` | Uranus | 2048 × 1024 | observed | Solar System Scope (2k_uranus.jpg; no larger openly licensed map) | CC BY 4.0 |
| `moon-real.jpg`, `moon-real-8k.jpg` | Moon | 4096 × 2048 / 8192 × 4096 | observed | Solar System Scope (8k_moon.jpg, byte-identical upstream) | CC BY 4.0 |
| `io-real.jpg` | Io | 4096 × 2048 | observed | ItzImcool; NASA/JPL-Caltech/ASI/USGS; NASA/JPL/SwRI/MSSS/Gerald Eichstädt/Jason Perry/John Rogers; AstroChara | CC BY 4.0 |
| `europa-real.jpg` | Europa | 4096 × 2048 | observed | John van Vliet; NASA/JPL Galileo and Voyager imagery | Celestia legacy texture, see note |
| `ganymede-real.jpg` | Ganymede | 4096 × 2048 | observed | Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS; NASA/JPL-Caltech/Björn Jónsson; NASA/JPL-Caltech/SwRI/MSSS/Brian Swift | CC BY 3.0 |
| `callisto-real.jpg` | Callisto | 4096 × 2048 | observed | Askaniy Anpilogov from John van Vliet; NASA/JPL Galileo and Voyager imagery | Celestia legacy texture, see note |
| `mimas-real.jpg` | Mimas | 4096 × 2048 | observed | Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal) | Celestia legacy texture, see note |
| `enceladus-real.jpg` | Enceladus | 4096 × 2048 | observed | Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal) | Celestia legacy texture, see note |
| `tethys-real.jpg` | Tethys | 4096 × 2048 | observed | Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal) | Celestia legacy texture, see note |
| `dione-real.jpg` | Dione | 4096 × 2048 | observed | Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal) | Celestia legacy texture, see note |
| `rhea-real.jpg` | Rhea | 4096 × 2048 | observed | Celestia, from Björn Jónsson's albedo map and NASA/JPL Cassini data (Paul Schenk) | Celestia legacy texture, see note |
| `titan-real.jpg` | Titan | 4096 × 2048 | observed | Askaniy Anpilogov, Pedro Garcia, AstroChara; NASA/JPL-Caltech/ASI/USGS; Caltech-JPL/Univ. of Arizona/LPG Nantes-CNRS | CC BY 3.0 |
| `hyperion-real.jpg` | Hyperion | 2048 × 1024 | observed | ItzImcool | CC BY 4.0 |
| `iapetus-real.jpg` | Iapetus | 4096 × 2048 | observed | Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal) | Celestia legacy texture, see note |
| `miranda-real.jpg` | Miranda | 4096 × 2048 | observed | ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk | CC BY-SA 4.0 |
| `ariel-real.jpg` | Ariel | 4096 × 2048 | observed | ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk | CC BY-SA 4.0 |
| `umbriel-real.jpg` | Umbriel | 2048 × 1024 | observed | ItzImcool; Paul Schenk (2020); Phil Stooke (2006); NASA/JPL/Ted Stryk | CC BY-SA 4.0 |
| `titania-real.jpg` | Titania | 2048 × 1024 | observed | ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk | CC BY-SA 4.0 |
| `oberon-real.jpg` | Oberon | 2048 × 1024 | observed | ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk | CC BY-SA 4.0 |
| `triton-real.jpg` | Triton | 4096 × 2048 | observed | Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS | CC BY 3.0 |
| `concept-asteroid.jpg` | Naiad, Thalassa, Despina, Galatea, Larissa, Proteus | 4096 × 2048 | concept | cubicApocalypse (fictional asteroid texture) | CC BY 4.0 |
| `concept-haumea.jpg` | Nereid | 4096 × 2048 | concept | Solar System Scope (4k_haumea_fictional.jpg) | CC BY 4.0 |
| `star-g.jpg` | Alpha Centauri A | 4096 × 2048 | concept | MrSpace43; AstroChara; NASA/SDO and the AIA, EVE and HMI science teams | CC BY-SA 4.0 |
| `star-k.jpg` | Alpha Centauri B | 4096 × 2048 | concept | MrSpace43; AstroChara; NASA/SDO and the AIA, EVE and HMI science teams | CC BY-SA 4.0 |
| `star-m.jpg` | Proxima Centauri | 4096 × 2048 | concept | Askaniy Anpilogov (2025) | CC BY 3.0 |
| `concept-makemake.jpg` | Proxima b | 4096 × 2048 | concept | Solar System Scope (4k_makemake_fictional.jpg) | CC BY 4.0 |
| `concept-ceres.jpg` | Proxima d | 4096 × 2048 | concept | Solar System Scope (4k_ceres_fictional.jpg) | CC BY 4.0 |
| `concept-venuslike.jpg` | Proxima c | 4096 × 2048 | concept | cubicApocalypse (fictional cloud-world texture) | CC BY 4.0 |

Notes:

- Solar System Scope textures are licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The 8K Moon and Mars originals were retrieved from a GitHub mirror and verified byte-identical to the published upstream SHA-256; the delivered 8192 × 4096 versions use JPEG quality 90 alongside the resized 4096 × 2048 compact versions. Mercury comes from a mirror that ships the upstream 8K map downscaled to 4096 px. Solar System Scope publishes Uranus only at 2K, and the only larger Uranus map found (CelestiaContent) is non-commercial, so Uranus stays at 2048 × 1024.
- Maps marked "Celestia legacy texture" have no per-file SPDX license in [CelestiaContent](https://github.com/CelestiaProject/CelestiaContent). Celestia's README credits Paul Schenk's enhanced-colour Cassini maps from the NASA Photojournal (Mimas, Enceladus, Tethys, Dione, Rhea, Iapetus; Rhea also uses Björn Jónsson's albedo map) and John van Vliet (Europa, and the source of Askaniy Anpilogov's Callisto). These textures were distributed with Celestia under GPL-2.0-or-later, and the underlying NASA/JPL imagery is used under the [JPL Image Use Policy](https://www.jpl.nasa.gov/jpl-image-use-policy). They are listed separately so they can be swapped if a stricter licence review requires it.
- Voyager 2 imaged only one hemisphere of Miranda, Ariel, Umbriel, Titania, Oberon and Triton. The source maps fill the rest with flat grey; `scripts/prepare-body-textures.py` replaces that placeholder with a mirrored, longitude-shifted copy of imaged terrain and a soft blend. These filled hemispheres are illustrations, not observations.
- The Alpha Centauri star maps are concept textures derived from NASA/SDO solar imagery (CC BY-SA 4.0) and an original M-dwarf texture (CC BY 3.0); the game uses only their luminance and colours them by each star's temperature.
- JPEG re-encoding keeps the standalone assets compact: quality 85 for the 4K and 2K versions, quality 90 for the native 8K Mars and Moon files. Exact source URLs (pinned Git revisions), changes, pixel sizes and SHA-256 checksums of sources and delivered files are in [public/textures/provenance.json](public/textures/provenance.json). Run `python3 scripts/prepare-body-textures.py` (Python, NumPy, Pillow) to download, verify and rebuild them.
- Retrieved on 2026-10-03 through normal HTTPS access to GitHub: CelestiaContent `57daa0d8d33d4799a721c496de62f019e335f625`, Whitebee7/solarsystem `235e72c02e825e0c8d0792ec0aa6be43e1a14f68`, renoultdavid/textures `68b6d34056efb1065207f0b5e139d5998cc0a575`, 7ohnkuu/universe `200f5667391eb512a032e20b00bf41887eadc2b9`.

Rendering: magnified maps use cubic B-spline filtering and seam-aware texture gradients. The shared 16K material supplies filtered artistic microdetail, and solid-body relief normals come from the same height field as geometry and collision. Until a moon, star or exoplanet map loads, a procedural loading fallback is shown.

## Procedural material and atmospheric entry

`src/procedural-body.ts` assigns every one of the 43 celestial bodies a deterministic identity seed and rock, ice, gas or stellar morphology. The current 16K material evaluates the same filtered microstructure in orbital and local views; it preserves each photograph or concept map's delivered resolution and colour. Generated grains, fractures and cloud filaments are game artwork, not additional measured surface data. Independently switched orbital grain and material-alpha relief no longer replace the shared ground material or height.

The detailed survey ship, its curved panels and turbines, soft layered ion exhaust, kilometre-scale local cloud volume and curved terrain meshes are original project geometry/shaders. Local Earth clouds with a 7.8 km base and billowing 10.5–15.5 km tops and the softened surface haze provide continuous entry. The clouds are illustrative weather; physical terrain sources and their measured/artistic distinction are described above.

## Alpha Centauri system artwork

`centauri-milky-way-4k.jpg` is an original 4096 × 2048 spherical sky illustration generated by [scripts/generate-centauri-sky.py](scripts/generate-centauri-sky.py), with a seeded blue-violet galactic band, dark dust lanes and star points. It is **not an observed or astrometrically accurate sky map**. Earlier Alpha Centauri and Proxima versions used this artwork; the current game uses the native astronomical Milky Way panorama described above. The retired image and its SHA-256 remain in the repository/provenance record, and the current offline ZIP excludes it.

Alpha Centauri A/B, Proxima and Proxima b, c and d use the stage 06 concept maps, coloured by temperature or tinted; their original procedural shaders remain only as the loading fallback. The planets' radii, atmosphere and visible surface are illustrative game choices, not measured images; c/d are explicitly labelled as candidates. Stellar sizes, approximate Sun distances, binary mean separation and orbital periods provide scale, with a static illustrative layout and fictional faster-than-light travel.

## Betelgeuse red-supergiant artwork

`betelgeuse-8k.jpg` is an original **8192 × 4096** equirectangular illustration, evaluated directly at native resolution by `scripts/generate-betelgeuse-texture.py` (Python, NumPy, Pillow, SciPy). Seeded spherical convection cells, cooler inter-cell lanes, warped turbulence and four granulation scales form a seamless field across longitude and the poles. `betelgeuse-4k.jpg` is the filtered **4096 × 2048** alternate loaded directly on touch/low-memory devices or GPUs with a maximum texture size below 8192. These original project assets are released under CC0-1.0; dimensions and checksums are recorded in the provenance manifest. Neither map is an observed global photograph.

The red-supergiant shader preserves the map colour and adds slow convection modulation, limb darkening, fine grain at high magnification and a warm stellar halo. The system currently contains only Betelgeuse, with stellar collision protection and no landing. Approximate radius 764 solar radii and distance 548 light-years follow the estimates in Joyce et al. (2020), [arXiv:2006.09837](https://arxiv.org/abs/2006.09837); these values remain uncertain. Temperature is approximately 3600 K. It shares the current 8K/4K astronomical Milky Way panorama with its own orientation and brightness.

## 小行星带与轨道空间站

`src/orbital-structures.ts` 中的小行星不规则几何、主带粒子及空间站舱体、太阳能翼、天线和灯光均为本项目原创程序模型，无外部贴图。主带 2.1–3.3 AU 为示意范围，谷神星为 2.77 AU 导航入口；局部岩群密度为游戏美术示意。空间站在地球上方 400 km 的固定位置，跨度 120 km 是科幻游戏尺度，不代表真实国际空间站。详见 `docs/ORBITAL-EXPLORATION.md`。


## 回声裂隙参考风格模型

`src/pulsar-model.ts` 的蓝紫等离子、蓝白双极喷流、白色日冕和倾斜灰金尘雾，以及 `src/shattered-model.ts`、`src/shattered-geometry.ts`、`src/shattered-material.ts`、`src/shattered-lava.ts` 的近圆球壳、不规则主裂带与分支、裸露熔融内层和曲面岩壳碎片，均为本项目程序化几何与着色器。外观参考用户提供的脉冲星与碎裂星球图片；图片本身未作为贴图或网站素材分发。星球形态和发光效果属于虚构美术，不代表真实天体成像。

碎裂模型的外壳与碎块共用三维材质和原始球面坐标，包含灰白矿层、铁锈红与橄榄色矿物、炭化区、岩层颗粒、微裂缝以及低反光的粗糙岩石反射。非周期节点裂带提供突变转折、宽窄变化、断续分支、岩桥与参差断壁；几何裂缝和材质热损伤采样同一裂带函数。熔融内层由暗色冷却岩壳、窄亮流道和沿视线的多层热流采样组成，断壁保留暗色岩层与局部热反光。程序微细节覆盖七级颗粒尺度并按屏幕像素过滤，最高空间频率对应 32768 像素赤道采样；这是连续生成的材质细节预算，不是原生 32K 照片或放大贴图。
