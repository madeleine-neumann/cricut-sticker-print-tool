# Stickerwerkstatt

**Deutsch** · [English](#english)

Aus eigenen Motiven wird ein druckfertiger Stickerbogen mit passender Schnittdatei für Cricut und andere Schneideplotter.

**Online:** https://madeleine-neumann.github.io/cricut-sticker-print-tool/

## Funktionen

1. **Motive:** PNG- oder WebP-Dateien mit transparentem Hintergrund auswählen oder hineinziehen. Für jedes Motiv werden Höhe und Anzahl eingetragen. Die Schnittkante wird erst berechnet, wenn eine Höhe eingetragen ist; eine in der PNG-Datei gespeicherte Auflösung wird als Vorschlag angezeigt.
2. **Schnittkante:** Jedes Motiv hat eigene Einstellungen für Beschnitt, Außenrand (unbedruckt oder farbig) und erweiterte Konturoptionen. Einstellungen lassen sich auf alle Motive übertragen.
3. **Bogen & Export:** Papierformat (A4, US Letter, 9 × 12 und 12 × 12 Zoll, Cricut-Joy-Matten), Raster oder platzsparende Anordnung mit Drehung, Seitenrand und Abstand. Kleine Matten können mehrfach auf ein Letter- oder A4-Blatt gelegt werden.

Ein **Kontrollquadrat von 1 × 1 cm** wird mitgedruckt. Misst es nach dem Druck genau 10 mm, stimmt die Skalierung. In den SVG-Dateien liegt es auf der eigenen Ebene `calibration-1cm` und kann in Cricut Design Space ausgeblendet werden. Es lässt sich in den Bogen-Einstellungen abschalten.

### Druckdatei und Schnittdatei

| Datei | Zweck |
| --- | --- |
| PDF, PNG, Druck im Browser | **Druckdatei** im vollen Papierformat. Mit 100 % bzw. „Tatsächliche Größe“ drucken, nicht „An Seite anpassen“. PNG-Dateien enthalten die Auflösung als Metadaten. |
| Schnitt-SVG | **Schnittdatei**: nur die Konturen, an denselben Positionen wie in der Druckdatei. Optional mit Seitenumriss zum Ausrichten. |
| Druck und Schnitt als SVG | Druckbild und Konturen in einer Datei für Print-then-Cut. |
| Einzelmotiv | Das gewählte Motiv mit Beschnitt als PNG, als Schnitt-SVG oder kombiniert. |

Ist das Papier größer als der Schneidebereich der Cricut-Matte (z. B. A4 mit 297 mm gegenüber 292 mm), bleiben die Sticker auf Wunsch innerhalb des Bereichs, und nur der SVG-Seitenumriss wird gekürzt.

### Datenschutz

Alle Bilder werden ausschließlich im Browser verarbeitet. Es werden keine Dateien hochgeladen und keine externen Schriften oder Dienste geladen.

### Sprache

Deutsch und Englisch sind vollständig übersetzt. Beim ersten Besuch entscheidet die Browsersprache; die Auswahl über **DE / EN** wird danach gespeichert.

## Entwicklung

Voraussetzung: Node.js 22.

```sh
npm ci
npm run dev       # Entwicklungsserver
npm test          # Typprüfung, Engine-Parität, Bogen-, Export- und UI-Tests, Produktions-Build
npm run build     # statischer Build in dist/
npm run preview   # Build unter /cricut-sticker-print-tool/ ansehen
```

Aufbau: Svelte 5, TypeScript und Vite. `src/lib/engine/` enthält die Rechenfunktionen für Maske, Kontur, Layout und Dateiformate, `src/lib/sheets.ts` die Bogenplanung, `src/lib/export.ts` die Dateien und den Druck, `src/components/` die Oberfläche und `src/lib/locales/` die Übersetzungen. `tests/fixtures/legacy-engine.js` ist die Rechen-Engine des Vorgängertools; die Tests vergleichen die neue Umsetzung damit.

Jeder Push auf `main` wird über GitHub Actions getestet und auf GitHub Pages veröffentlicht (`.github/workflows/pages.yml`).

## Lizenz

[MIT](LICENSE). Abhängigkeiten stehen unter ihren eigenen Lizenzen.

---

<a id="english"></a>

# Sticker Workshop

[Deutsch](#stickerwerkstatt) · **English**

Turn your own artwork into a print-ready sticker sheet with a matching cut file for Cricut and other cutting machines.

**Online:** https://madeleine-neumann.github.io/cricut-sticker-print-tool/

## Features

1. **Artwork:** Choose or drop PNG or WebP files with a transparent background. Enter a height and number of copies for each artwork. The cut line is only calculated once a height is entered; a resolution stored in the PNG file is shown as a suggestion.
2. **Cut line:** Each artwork has its own bleed, outer border (blank paper or colored) and advanced contour options. Settings can be applied to all artwork.
3. **Sheet & export:** Paper size (A4, US Letter, 9 × 12 and 12 × 12 in, Cricut Joy mats), simple grid or nested layout with rotation, page margin and spacing. Small mats can be repeated on a Letter or A4 page.

A **1 × 1 cm check square** is printed on the sheet. If it measures exactly 10 mm after printing, scaling is correct. In the SVG files it sits on its own `calibration-1cm` layer and can be hidden in Cricut Design Space. It can be switched off in the sheet settings.

### Print file and cut file

| File | Purpose |
| --- | --- |
| PDF, PNG, browser print | **Print file** at full paper size. Print at 100% or “Actual size”, not “Fit to page”. PNG files carry their resolution as metadata. |
| Cut SVG | **Cut file**: contours only, at the same positions as in the print file. Optional page outline for alignment. |
| Print and cut SVG | Print image and contours in one file for Print Then Cut. |
| Single artwork | The selected artwork with bleed as PNG, cut SVG or combined. |

When the paper is larger than the Cricut mat cutting area (for example A4 at 297 mm versus 292 mm), stickers can be kept inside that area and only the SVG page outline is shortened.

### Privacy

All images are processed in the browser only. No files are uploaded, and no external fonts or services are loaded.

### Language

German and English are fully translated. The browser language decides on the first visit; the **DE / EN** choice is remembered afterwards.

## Development

Requires Node.js 22.

```sh
npm ci
npm run dev       # development server
npm test          # type check, engine parity, sheet, export and UI tests, production build
npm run build     # static build in dist/
npm run preview   # serve the build under /cricut-sticker-print-tool/
```

Structure: Svelte 5, TypeScript and Vite. `src/lib/engine/` holds the mask, contour, layout and file format functions, `src/lib/sheets.ts` the sheet planning, `src/lib/export.ts` the files and printing, `src/components/` the interface and `src/lib/locales/` the translations. `tests/fixtures/legacy-engine.js` is the previous tool's engine; the tests compare the new implementation against it.

Every push to `main` is tested and published to GitHub Pages by GitHub Actions (`.github/workflows/pages.yml`).

## License

[MIT](LICENSE). Dependencies keep their own licenses.
