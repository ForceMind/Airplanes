# 1940 aircraft reference and implementation notes

This game now models **Spitfire Mk Ia** and **Messerschmitt Bf 109 E-4** as separate airframes. The year and variants matter: the Spitfire has the eight-Browning A wing; the Bf 109 has the E-series airframe, two cowling machine guns and two wing cannon. Later Spitfire cannon wings, four/five-blade propellers, Bf 109 G cowling bulges, a centreline motor cannon and the later Erla canopy are outside this implementation.

The aircraft art is original, procedural voxel geometry. It is a deliberately coarse reconstruction from public references, not a scan, a factory drawing, or a flight simulator certified to engineering tolerances.

## Reference configuration

| Feature | Spitfire Mk Ia | Bf 109 E-4 |
| --- | --- | --- |
| Nominal span used | 11.23 m | 9.87 m |
| Nominal length used | 9.12 m | 8.74 m |
| Main wing | Elliptical A-wing planform | Straight tapered E-wing planform with short blunt tips |
| Engine family | Rolls-Royce Merlin III | Daimler-Benz DB 601 |
| Propeller | Three blades | Three blades |
| Guns | Eight .303 / 7.7 mm Brownings, four in each wing | Two 7.92 mm MG 17 above the engine; one 20 mm MG FF/M in each wing |
| Visible cooling layout | Starboard radiator bath and smaller port oil cooler | Two underwing radiator baths and a chin oil cooler |
| Cockpit and tail | Rounded early hood, curved fin and horizontal tail | Framed E-4 hood, narrower upright fin and braced tailplane |
| Exhaust | Three paired short outlets per side | Six short outlets per side |

The Science Museum's Mk Ia entry gives the Spitfire's 11.23 m span and 9.12 m length [1]. The RAF Museum also lists the eight .303 guns as four in each wing [2], and describes the move to a three-bladed metal propeller and revised hood [3]. The Air Ministry's original Spitfire I handbook supplies the configuration and general-arrangement reference [4].

The RAF Museum's history of E-4/B airframe 4101 quotes the 1940 captured-aircraft report recording two MG 17s and two 20 mm guns, a DB 601 A-1, and a constant-speed propeller. It also documents the airframe's E-4 windscreen [5]. We use the fighter configuration, without that individual airframe's bomb conversion or identification codes. Its service/restoration history is a reason not to copy every detail of a later museum photograph indiscriminately.

**Dimension precision:** Bf 109 E dimensions vary slightly across published tables and restored configurations. The Revell E-4 manufacturer's reference table gives 9.86 m by 8.74 m [6]; this model's nominal 9.87 m span differs by 1 cm. These values establish proportions, not a claim of centimetre accuracy. The sampled airframes occupy 56 × 46 model units for the Spitfire and 49 × 44 for the Bf 109. At five units per metre, each published dimension is reproduced within a single voxel. The Revell introduction contains a contradictory sentence about cannon placement; its armament **table**, the RAF Museum record, and the model's wing-cannon geometry agree. Do not import that erroneous sentence into game copy.

## Shape and finish

The airframes have independently generated fuselages, main planes, tailplanes, fins, cockpit glazing and radiator geometry. The Spitfire's wings use curved leading and trailing edges. The Bf 109's use linear taper. Wing span is based on the common metre scale, so the wider Spitfire stays wider when both actors use the same scale. Gear is represented retracted; no extended main wheels are drawn during flight.

The default RAF palette represents a 1940 dark-green/dark-earth upper finish and pale Sky-style underside. Upper-wing roundels are red and blue; the fuselage identifier uses separate light/yellow rings. The default German palette uses grey/green fields, a pale blue underside, and yellow cowling/rudder. The last two colour locations have a direct 1940 example in the RAF Museum's captured-aircraft record [5]. Exact paint spectra, camouflage stencil shapes, aircraft serials, squadron codes and individual pilot markings are not reconstructed. The default skins are explicitly labelled as period **style**, not a named historical aircraft.

All eight previous skin IDs are preserved for saved selections. The other six palettes are clearly labelled **创意涂装** in the hangar: coastal, night and silver RAF options; desert, winter and night German options. They reuse the correct airframe and do not claim to be 1940 Battle of Britain operational finishes.

## Single geometry / weapon contract

`src/game/aircraft-specs.js` is the shared source for model, hangar and combat:

```js
getAircraftSpec('spitfire' | 'bf109')
// {
//   id, faction, variant, year, unitsPerMetre: 5, modelScale: .72,
//   dimensions: { wingspanMetres, lengthMetres },
//   wingType, engine, armamentLabel,
//   gunMounts: [{ id, name, kind, calibreMm, x, y, z,
//                 roundsPerMinute, muzzleVelocity, ammo }],
//   propeller: { x, y, z, radius, bladeCount: 3,
//                hubRadius, bladeWidth, rotationSign,
//                bladeColor, tipColor }
// }
```

Local axes are **x right/starboard, y forward/nose, z up**. Coordinates are centred on the model, not a bitmap corner. `modelScale` converts model units to the game's world units; it is not another physical metre conversion. All definitions and nested data are frozen.

`createAircraftModel()` exposes the same frozen `spec`, `gunMounts` and `propeller` objects. Its visible `gun-port` voxels use the exact coordinates of the combat mounts. The port coordinates and small fairings are low-resolution reconstructions, not measured factory station coordinates. The Spitfire has eight flush ports; the Bf 109 has two upper-cowling troughs and two projecting wing cannon. The combat emitter transforms those same coordinates through the actor's complete orientation. Moving the visible ports without moving their spec is therefore an error.

Static `model.voxels` contain the spinner but **no propeller blades**. `createPropellerVoxels()` generates a separate three-blade mesh in the hub's local x/z plane. World rendering and the hangar use that helper. The hangar accepts `options.time` in seconds, or `options.propellerPhase` for a still view. Its auto-fit uses the full rotor envelope, keeping the apparent airframe scale steady as the propeller turns. `showHardpoints` adds gold machine-gun markers and orange cannon markers at the shared muzzle positions.

The propeller animation has a visual shaft rate and a coarse shutter/blur treatment. It does not simulate engine management, gearing, blade pitch, synchronisation mechanisms or the optical appearance of every real shutter speed.

## Historical weapons versus game tuning

Weapon identity, count, calibre class and mounting location are the historical configuration. The numerical firing parameters are **representative game inputs**:

| Weapon | Nominal cyclic rate in code | Nominal muzzle velocity in code | Ammunition metadata per gun |
| --- | --- | --- | --- |
| .303 Browning | 1,150 rounds/min | 744 m/s | 300 |
| MG 17 | 1,000 rounds/min | 775 m/s | 1,000 |
| MG FF/M | 520 rounds/min | 600 m/s | 60 |

Real rates vary with gun setup, synchronisation, ammunition and measurement conditions; the various cannon projectiles do not all have one muzzle velocity. These nominal numbers must not be presented as an exact reproduction of every 1940 loading. The US Navy technical compendium gives one MG 17 reference range of 750–1,000 rounds/min and approximately 778 m/s [7]. The values for other weapons are deliberately treated as tuning references, not newly asserted archival measurements.

The current game keeps ammunition unlimited; `ammo` is reference metadata, not an active magazine limit. `src/game/ordnance.js` maps nominal muzzle velocity through `BALLISTIC_SPEED_SCALE = .9` and adds aircraft velocity. Flight distance/time are therefore not a 1:1 physical scale. Machine-gun damage 1.65, cannon damage 9 and the 380-world-unit convergence distance are game balance settings, not historical lethality or harmonisation claims. Weapon cadence is independent for each gun; gun-count realism is not represented by painting two universal tracer beams.

## Verification

`tests/aircraft.test.js` checks real span/length ratios, measurable curved/straight wing differences, variant-specific cooling and tail structure, eight-versus-four exact visible gun ports, three-blade meshes without a fixed cross, saved skin compatibility, and preview bounds at top/oblique/profile angles. Rendering checks use the actual procedural geometry, not a mock illustration.

## Sources

1. Science Museum, *Flight — Large Print Book 2 of 3*, “Aircraft: Supermarine Spitfire Mk 1A, 1940”: <https://www.sciencemuseum.org.uk/sites/default/files/2025-11/Flight-Large%20Print%20Book%202%20of%203-DIGITAL.pdf>.
2. RAF Museum, *Battle of Britain — Cosford large-print guide*, Spitfire Mk I entry: <https://www.rafmuseum.org.uk/documents/LargePrintGuides/BoB_Guides/LPG_Battle_of_Britain_Cosford_web.pdf>. The Bf 109 G section in this guide is **not** an E-4 specification.
3. RAF Museum, “The first flight of the Spitfire”: <https://www.rafmuseum.org.uk/blog/the-first-flight-of-the-spitfire/>. Variant-specific museum entry: <https://www.rafmuseum.org.uk/london/exhibition-items/supermarine-spitfire-mk-ia/>.
4. Air Ministry, *AP 1565A, Volume I: Spitfire I*, original handbook, digitised mirror: <https://stephentaylorhistorian.com/wp-content/uploads/2020/04/ap1565a-spitfire1.pdf>.
5. RAF Museum, Andrew Simpson, *Individual History: Messerschmitt Bf109E-4/B W/Nr.4101*, 2018, especially pages 1–3: <https://www.rafmuseum.org.uk/documents/collections/78-AF-624_Bf109E_4101.pdf>. Museum type entry: <https://www.rafmuseum.org.uk/london/exhibition-items/messerschmitt-bf-109e-4-b/>.
6. Revell, *Messerschmitt Bf 109 E-4, 04679-0389*, 2010, manufacturer's dimensions/armament table and assembly/paint views: <https://downloads.revell.de/Manuals-Modelkits/CM_04679.pdf>. The manufacturer's old download redirects; the same original publication can be read at <https://www.manualslib.com/manual/586739/Revell-Bf-109-E-4.html>. This is a model manufacturer's reference, not Messerschmitt factory engineering data.
7. George M. Chinn, US Navy Bureau of Ordnance, *The Machine Gun*, Volume I, comparative technical tables, 1951, digitised government publication: <https://www.ibiblio.org/hyperwar/USN/ref/MG/I/MG-B.html>.

References checked during this implementation on 16 November 2026. No third-party aircraft meshes, textures, handbook illustrations or kit artwork are redistributed in the game.
