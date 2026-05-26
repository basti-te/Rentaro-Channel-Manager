# Landing-Page Bild-Assets

Die Landing-Page (`/`) erwartet **fünf** Bilder in diesem Verzeichnis.
Du hast die Originale via Chat-Anhang geschickt — speichere sie als:

| Dateiname | Inhalt | Wo in der Landing | Optimaler Aspect |
| --- | --- | --- | --- |
| `hero.jpg` | Blauer Koffer wird durch helles Wohnzimmer gezogen | (z. Zt. nicht direkt verwendet — Reserve) | 3:2 |
| `guests.jpg` | Lachendes Paar (~60) kommt mit Koffer an | Hero-Section (rechts) | 4:5 |
| `operator.jpg` | Mann mit Laptop + Handy in Außenbereich | "Warum Rentaro" Section | 5:4 |
| `channels.jpg` | iPhone-Icons: Booking, Airbnb, Vrbo | "Bald an Bord" Section | 4:3 |
| `key.jpg` | Hausschlüssel mit Haus-Anhänger im Schloss | Final CTA (Hintergrund) | 21:9 (querformat ideal) |

**Format-Empfehlung:**
- JPG, ~85 % Qualität
- 2000 px lange Kante reicht; mehr verschwendet Bandbreite
- Komprimiere mit z. B. [TinyJPG](https://tinyjpg.com/) oder `cwebp`/`mozjpeg`

**Optional:** zusätzlich als `.webp` ablegen (z. B. `hero.webp`) — der Browser fragt das von alleine an wenn wir `<picture>` einbauen. Für v1 reicht JPG.
