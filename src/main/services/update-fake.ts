import type { UpdaterPort } from './update'

/**
 * Un updater finto, per guardare i sette stati senza pubblicare una Release.
 *
 * **Perché esiste.** In sviluppo `electron-updater` è inerte per due guardie
 * sue: una generica sull'app non impacchettata, una specifica dell'AppImage. E
 * su Fedora il ramo `downloading` → `ready` non è esercitabile nemmeno
 * forzandole, perché `doInstall` fa `unlinkSync` sul percorso che
 * `process.env.APPIMAGE` indica — falsificarlo per «provare» cancella un file
 * vero. Quindi o si finge la porta, o quei tre stati non li vede nessuno prima
 * che li veda un utente.
 *
 * **Perché è in `src/` e non in uno script di prova.** Perché lo scopo è
 * guardare l'*interfaccia*, non il servizio: il servizio si esercita da fuori
 * con `/prova-servizio`, ma le sei righe del documento 2 §4.12 le disegna il
 * renderer, e per arrivarci il finto deve stare dentro l'app che parte.
 *
 * Si accende solo con `FANTA_FAKE_UPDATER` **e** con l'app non impacchettata:
 * `index.ts` controlla `app.isPackaged`, quindi in un pacchetto la variabile
 * non fa niente.
 *
 * `FANTA_FAKE_UPDATER` vale il nome dello scenario:
 *   `none`      nessun aggiornamento
 *   `available` una versione nuova, con le note
 *   `download`  available, e poi la barra fino a `ready` quando si preme Scarica
 *   `error`     il controllo fallisce
 *   `manual`    come `available`, ma fingendo una build che non sa installarsi
 *   `idle`      non controlla affatto: lascia lo stato iniziale a schermo
 */
export function makeFakeUpdaterPort(scenario: string): UpdaterPort {
  let events: Parameters<UpdaterPort['listen']>[0] | null = null
  const version = '9.9.9'
  const url = 'https://github.com/edocico/fanta-help/releases/tag/v9.9.9'

  return {
    listen: (h) => {
      events = h
    },
    // Lo scenario decide anche questo, invece di ereditarlo dalla build. È il
    // solo modo di guardare `manual` su Fedora, dove `process.platform` non è
    // mai `darwin` e nessuna variabile lo rovescia: un doppione può mentire
    // sulla piattaforma, ed è tutto ciò che serve perché la scaletta degli otto
    // stati sia percorribile su qualunque macchina.
    canInstallItself: scenario !== 'manual',

    check: async () => {
      // Non emette niente e non passa da `checking`: lo stato resta `idle`, che
      // altrimenti dura i quattro secondi fra l'avvio e il primo controllo —
      // meno del tempo che ci mette lo script a lanciare l'app, quindi la sua
      // riga non è mai stata guardata da nessuno.
      if (scenario === 'idle') return

      events?.checking()
      // Un respiro, perché `checking` esiste solo finché una richiesta di rete
      // è in volo: senza, la vista passa da `idle` all'esito senza mai
      // disegnarlo, e lo stato resterebbe non guardato proprio nella prova che
      // serve a guardarli tutti.
      await pause(400)
      if (scenario === 'error') {
        events?.failed('Non riesco a raggiungere GitHub.')
        return
      }
      if (scenario === 'none') {
        events?.none()
        return
      }
      events?.available({
        version,
        notes: '<h2>Novità</h2><p>Le note arrivano in <b>HTML</b> dal feed della Release.</p>',
        url,
      })
    },

    download: async () => {
      for (const percent of [0, 18, 47, 76, 100]) {
        events?.progress(percent)
        await pause(300)
      }
      events?.downloaded(version)
    },

    install: () => {
      // Non riavvia niente: la prova finisce qui, e un `app.relaunch()` in
      // sviluppo chiuderebbe la sessione che sto guardando.
      process.stdout.write('[updater finto] installazione richiesta e accettata\n')
    },

    openDownloadPage: (target) => {
      process.stdout.write(`[updater finto] aprirei ${target}\n`)
    },
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
