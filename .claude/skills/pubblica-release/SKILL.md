---
name: pubblica-release
description: Costruisce, verifica e pubblica una Release su GitHub, col feed che l'updater legge davvero. Usare quando si alza la versione e si vuole distribuire.
disable-model-invocation: true
version: 0.1.0
---

# Pubblica una Release

Il documento 3 §8 dice che pubblicare è «alzare il numero in `package.json`,
eseguire la build, caricare gli artefatti come Release». È vero e incompleto:
la prima volta, quel giro ha incontrato **due difetti che sarebbero stati
permanenti**, e nessuno dei due si vede leggendo il codice.

Questa skill è la sequenza che ha funzionato, con dentro le trappole.

## Cosa può andare storto in silenzio

**La Release nasce draft.** `releaseType` ha `@default draft` nei tipi di
`builder-util-runtime`, e una Release draft l'updater non la vede: il controllo
passa da `/releases/latest`, che le salta. L'`electron-builder.yml` ora porta
`releaseType: release` — se sparisce, `--publish always` produce una Release
completa, con gli artefatti e il feed, e invisibile a ogni app installata.

**Il nome del file non combacia col feed.** `productName` contiene uno spazio,
quindi su disco esce `Fanta Help-0.1.0.AppImage`, mentre `latest-linux.yml`
dichiara `Fanta-Help-0.1.0.AppImage` col trattino. Caricando il file com'è,
l'updater cerca un nome che non esiste.

**Il tag non è una convenzione.** `src/main/index.ts` costruisce il link dello
stato `manual` come `releases/tag/v${info.version}`: con un tag diverso, il
bottone «Apri la pagina di download» porta su una pagina che non c'è.

**Due invocazioni di electron-builder non si sommano.** La seconda riscrive
`latest-linux.yml` e cancella dal feed l'artefatto della prima: la Release
avrebbe due file e un feed che ne dichiara uno.

**Il feed è un asset, non la Release.** `latest-linux.yml` è ciò che l'updater
scarica e legge; gli altri due file li trova solo perché quello li nomina, con
nome e sha512. Una Release perfetta senza yml, per l'app, non esiste — e
l'errore che ne esce parla di un file di canale, non di un aggiornamento.

## Procedura

**1. La versione, e il commit che la contiene.**
Alza `version` in `package.json`, committa, e assicurati che il commit da
taggare contenga davvero il codice che vuoi distribuire.

```bash
git push origin main
git tag v<version> && git push origin v<version>
```

**2. Il pacchetto, in una invocazione sola.**

```bash
npm run build && npx electron-builder --linux AppImage deb --x64
```

Da Fedora esce solo Linux x64, e non è colpa del modulo nativo —
`better-sqlite3` pubblica prebuild per l'ABI di Electron. NSIS vuole wine
(`⨯ wine is required`), il dmg muore su `Cannot find module 'dmg-license'`, che
npm non installa fuori da macOS. macOS si costruisce dal Mac.

**3. Il nome, e le impronte.** Questo passo non è cortesia.

```bash
cd release
mv "Fanta Help-<version>.AppImage" "Fanta-Help-<version>.AppImage"

# ogni sha512 del feed deve combaciare col file che stai per caricare
openssl dgst -sha512 -binary "Fanta-Help-<version>.AppImage" | openssl base64 -A
grep -m1 "sha512:" latest-linux.yml
```

**4. La Release, col feed dentro.**

```bash
gh release create v<version> \
  release/latest-linux.yml \
  release/Fanta-Help-<version>.AppImage \
  release/fanta-help_<version>_amd64.deb \
  --repo edocico/fanta-help \
  --title "Fanta Help <version>" \
  --notes "..."
```

Le note finiscono nello stato `available` dell'app, che le legge dal feed Atom
in HTML e le mostra come testo: scrivile per chi le leggerà lì.

## Verifica, e non è facoltativa

**In anonimo, come farebbe un'app installata** — la repo è pubblica, quindi non
serve nessun token:

```bash
curl -s https://api.github.com/repos/edocico/fanta-help/releases/latest \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['tag_name'], d['draft'], [a['name'] for a in d['assets']])"

curl -sL "https://github.com/edocico/fanta-help/releases/download/v<version>/latest-linux.yml" | head -6
```

`draft` dev'essere falso, e il nome che il feed dichiara dev'essere fra gli
asset.

**E poi la prova vera: l'app impacchettata contro la propria Release.**

```bash
env -u ELECTRON_RUN_AS_NODE ./release/Fanta-Help-<version>.AppImage \
  --appimage-extract-and-run > /tmp/appimage.log 2>&1 &
echo $! > /tmp/appimage.pid
sleep 12
grep -iE "update|checking" /tmp/appimage.log
kill "$(cat /tmp/appimage.pid)"
```

`--appimage-extract-and-run` perché su questa macchina manca FUSE2. Si chiude
per PID salvato, mai con `pkill -f`.

Pubblicando la versione che stai eseguendo, la risposta giusta è
`Update for version X is not available` — ed è la risposta **positiva** più
forte che si possa ottenere: dimostra che la catena intera ha funzionato, dove
un `available` direbbe solo che qualcosa non torna nei numeri.

L'AppImage usa la `userData` dell'app **installata**, non quella di sviluppo:
parte senza leghe, ed è normale.

## Quando distribuirai anche Windows o macOS

**Chi apre l'app su un sistema che non ha artefatti nella Release vede un
errore**, non «nessun aggiornamento»: il file di canale è per piattaforma, e il
404 diventa `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`. Finché nessuno ha mai
installato una build Windows o mac, pubblicare solo per Linux è innocuo. Dal
giorno che ne distribuisci una, ogni Release deve portare anche il suo file di
canale — `latest.yml` per Windows, `latest-mac.yml` per macOS.

E fra i bersagli mac c'è solo `dmg`: l'aggiornamento automatico di macOS vuole
anche uno `zip`, o muore con `ERR_UPDATER_ZIP_FILE_NOT_FOUND`. Oggi non si vede
perché su macOS non firmato lo stato è `manual` e l'app non scarica mai, ma il
giorno del certificato è un difetto già pronto.
