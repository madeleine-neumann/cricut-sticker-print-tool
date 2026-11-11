# Stickerwerkstatt: Design und technische Struktur

Status: zur Durchsicht

## Ziel

Das vorhandene Tool wird zu einer zweisprachigen, responsiven Webanwendung für GitHub Pages. Nutzerinnen und Nutzer laden transparente Motive, prüfen Beschnitt und Schnittkontur, ordnen Sticker auf einem Bogen an und exportieren Druck- und Schnittdateien. Die Bildverarbeitung bleibt lokal im Browser. Die vorhandenen Rechenfunktionen und Exportformate sollen erhalten bleiben.

## Visuelle Richtung

Die Anwendung wirkt wie eine aufgeräumte Sticker-Werkstatt. Die Vorschau ist das größte Element. Eine leicht gelöste Papierecke, eine gestanzte Kontur und wenige kleine gezeichnete Akzente geben ihr Charakter; Formulare und Statusmeldungen bleiben ruhig und präzise. Es gibt keine flächendeckenden Texturen oder Animationen.

| Rolle | Farbe |
| --- | --- |
| Hintergrund, kühles Papier | `#F7F9F6` |
| Schrift und Konturen | `#243248` |
| Primäraktion und aktive Auswahl | `#2846AA` |
| Sanfte Flächen | `#CFEADB` |
| Spielerische Akzente | `#FFC7A8`, `#D9D2FA` |

Ein ausdrucksstarker, gerundeter Display-Schnitt prägt Titel und wenige große Überschriften. Der Rest verwendet eine gut lesbare Sans-Serif mit deutlicher Größenhierarchie. Die genaue Schriftwahl muss auch deutsche Umlaute abdecken und als lokale Datei oder mit verlässlichem Fallback funktionieren.

Ein visueller Entwurf (nicht im Repository) zeigte die Desktop-Richtung. Die gezeichnete Figur diente nur zur Veranschaulichung des Layouts. Die produktive Oberfläche enthält keine mitgelieferten Illustrationen oder Beispielmotive; ihre Vorschau zeigt hochgeladene Motive.

## Bedienung

Die Oberfläche folgt drei nachvollziehbaren Abschnitten: **Motive**, **Schnittkante**, **Bogen & Export**. Diese Abschnitte sind navigierbar; vorhandene Eingaben bleiben beim Wechsel erhalten. Auf großen Bildschirmen stehen Einstellungen links und eine dauerhaft sichtbare Vorschau rechts. Auf kleinen Bildschirmen erscheinen Einstellungen und Vorschau in einer Spalte, mit gut erreichbarem Wechsel zwischen Motiv- und Bogenvorschau. Es gibt keinen erzwungenen Schrittwechsel für erfahrene Nutzer.

1. **Motive:** Dateien per Auswahl oder Drag-and-drop hinzufügen, Motive auswählen und entfernen, Motivhöhe und Kopienzahl einstellen. Die leere Ansicht erklärt den nächsten Schritt und bietet die Datei-Auswahl an.
2. **Schnittkante:** Beschnitt, Randart und Randbreite sowie die sichtbare Schnittlinie direkt am gewählten Motiv prüfen. Seltene Konturparameter stehen unter „Erweiterte Einstellungen“. Zahlenfelder bleiben für genaue Maße erhalten; Schieberegler sind nur Ergänzung.
3. **Bogen & Export:** Papierformat, Anordnung, Drehung, Abstand und Rand einstellen. Vorschau zeigt den tatsächlichen Bogen. Druckdatei und passende Schnittdatei werden als verständliche, zusammengehörige Exportoptionen angeboten. Einzelmotiv-Exporte bleiben erreichbar.

Warnungen stehen am betroffenen Feld oder an der Vorschau und sagen, wie man das Problem behebt. Während längerer Berechnungen ist der Zustand erkennbar; veraltete Ergebnisse werden nicht als aktuell angeboten. Die Exportaktion erklärt Dateitypen und erforderliche Druckskalierung in knapper Sprache.

## Mehrsprachigkeit

Deutsch und Englisch decken sämtliche sichtbaren Texte ab: Navigation, Formulare, Hilfen, Warnungen, Status, Exportbeschriftungen und Anleitung. Der Sprachumschalter **DE / EN** ist im Kopfbereich sichtbar. Beim ersten Besuch entscheidet die Browsersprache; danach hat die gespeicherte Wahl Vorrang. Zahlen und Maße werden sprachgerecht dargestellt, intern aber als Zahlen und Millimeter geführt. Übersetzungen sind Schlüssel in getrennten Sprachdateien, keine verstreuten Textabfragen in Komponenten. Dynamische Meldungen verwenden Parameter statt zusammengeklebter Satzteile. Fehlende Übersetzungen fallen im Build oder Test auf.

## Technische Struktur

**Svelte + TypeScript + Vite** bilden die Oberfläche. SvelteKit ist für diese einzelne statische Anwendung nicht erforderlich. Die vorhandene Berechnungslogik wird aus den numerisch geordneten Bundles in klar benannte Module mit einer stabilen Schnittstelle für Maske, Kontur, Layout und Export überführt. Bild- und Layoutberechnungen laufen bei großen Eingaben in einem Web Worker, damit Formulare und Vorschau bedienbar bleiben. Der App-Zustand hält Motive, Auswahl, Maße, Schnittoptionen und Bogeneinstellungen; berechnete Vorschauen werden daraus abgeleitet und bei Änderungen gezielt erneuert.

Komponenten entsprechen sichtbaren Aufgaben: App-Kopf und Sprache, Motivliste, Schnitt-Einstellungen, Motivvorschau, Bogen-Einstellungen, Bogenvorschau, Export und Statusmeldungen. Die Rechenmodule kennen keine Svelte-Komponenten oder DOM-Elemente. Download und Druck sind getrennte Adapter für Browserfunktionen.

Vite baut statische Dateien für GitHub Pages. Der Basispfad entspricht dem Repository-Pfad `/cricut-sticker-print-tool/`; ein GitHub-Actions-Workflow prüft und veröffentlicht den Build. Alle Assets und Links funktionieren unter diesem Unterpfad. Motive werden nicht auf einen Server geladen.

## Barrierefreiheit und Qualitätsnachweis

Alle Funktionen sind mit Tastatur erreichbar. Felder haben eindeutige Beschriftungen und zugeordnete Hilfen; Fehler werden auch als Text ausgegeben. Fokus ist deutlich sichtbar, aktive Zustände und Warnungen hängen nie allein von Farbe ab. Die Canvas-Vorschau erhält eine verständliche Textalternative mit Maßen und Status. Statusmeldungen werden angemessen angekündigt. Bewegung respektiert `prefers-reduced-motion`. Kontrast, Bediengrößen und Layout werden für Desktop und Mobil geprüft.

Die bestehenden Engine-Tests sichern Beschnitt, Kontur und Export während der Migration. Ergänzend werden die wesentlichen Nutzerwege geprüft: Motiv laden, Einstellungen ändern, zwischen Sprachen wechseln, Bogen berechnen und Dateien exportieren. Eine Produktionsvorschau wird unter dem tatsächlichen GitHub-Pages-Unterpfad geprüft.

## Veröffentlichung und Lizenz

Der Projektcode soll unter der MIT-Lizenz erscheinen. Diese erlaubt auch kommerzielle Nutzung und Weiterverwendung des Codes. Die Auftraggeberin hat bestätigt, dass ihr der bestehende Code gehört. Die bisherigen Illustrationen und Beispielbilder werden aus der neuen Anwendung entfernt. Rechte an etwaigen Schriften und weiteren Assets werden vor Veröffentlichung geprüft; Drittanbieter-Abhängigkeiten behalten ihre eigenen Lizenzen. Der alte Footer-Verweis auf Labcraft Studio entfällt mit der neuen Oberfläche.

## Entscheidungen

- „Stickerwerkstatt“ wurde als visuelle Richtung gewählt: freundlich und verspielt, mit sauberer, funktionaler Oberfläche.
- Der gezeigte visuelle Entwurf wurde als Grundlage bestätigt.
- Die Anwendung soll Deutsch und Englisch unterstützen, damit beide Sprachen gleichwertig nutzbar sind.
- Der Code soll unter MIT veröffentlicht werden; die zuvor erwogene Beschränkung gewerblicher Code-Nutzung entfällt.
- GitHub Pages ist das Veröffentlichungsziel; ein statischer Browser-Build passt zur lokalen Bildverarbeitung.
- Die bisherigen Illustrationen und das Beispielmotiv entfallen; die visuellen Akzente entstehen aus Typografie und CSS-Formen.
- Die Auftraggeberin hat bestätigt, dass ihr der bestehende Code gehört.
