import { eq } from 'drizzle-orm'
import type { UpdateStatus } from '@shared/contracts'
import { errorMessages, raise } from '@shared/errors'
import type { Db } from '../db/client'
import { league } from '../db/schema'

/**
 * L'aggiornamento dell'applicazione, T20 e documento 3 §8.
 *
 * **`electron-updater` non è importato qui, ed è la regola non un caso.**
 * `src/main/ipc/coverage.test.ts` carica `handlers.ts` su Node puro, e
 * `handlers.ts` importerà questo file: un `import { autoUpdater } from
 * 'electron-updater'` tirerebbe dentro `electron` e la prova morirebbe con un
 * errore che parla d'altro. L'updater arriva quindi come porta, dall'unico
 * posto a cui `electron` è concesso — `index.ts` — esattamente come già
 * arrivano `readGrid`, `backup` ed `emit`.
 *
 * Il secondo motivo è il criterio di chiusura di questo task. In sviluppo
 * l'updater vero è inerte per due guardie sue, quindi i sette stati non si
 * eserciterebbero mai: con la porta si inietta un updater finto e si guardano
 * tutti, senza pubblicare niente su GitHub.
 */

/**
 * Ciò che il servizio chiede a `electron-updater`, e nient'altro.
 *
 * Scritta come la usa il chiamante e non copiata dai tipi del pacchetto: un
 * `import type` da `electron-updater` sarebbe erasso e innocuo a runtime, ma
 * legherebbe questo file alla forma di una libreria che il servizio usa per
 * cinque cose su cinquanta.
 */
export type UpdaterPort = {
  /** Interroga il feed. Risolve quando l'esito è noto; gli eventi arrivano prima. */
  check: () => Promise<void>
  /** Scarica, e solo su richiesta. */
  download: () => Promise<void>
  /** Riavvia e installa. Non torna. */
  install: () => void
  /** Apre una pagina nel browser di sistema: lo stato `manual`. */
  openDownloadPage: (url: string) => void
  /** Registra chi ascolta gli eventi dell'updater. Chiamata una volta sola. */
  listen: (handlers: UpdaterEvents) => void
  /**
   * Se questa build può installare da sé.
   *
   * Falso su macOS non firmato, dove il meccanismo verifica la firma del
   * pacchetto sostitutivo e fallisce. Arriva da `index.ts` come costante di
   * build, non da `process.platform`: il documento 3 §8 promette che il giorno
   * del certificato basta cambiare la configurazione di electron-builder,
   * «nessuna riga di logica applicativa da riscrivere», e un `=== 'darwin'`
   * scritto qui sarebbe proprio quella riga.
   */
  canInstallItself: boolean
}

export type UpdaterEvents = {
  checking: () => void
  available: (info: { version: string; notes?: string; url: string }) => void
  none: () => void
  progress: (percent: number) => void
  downloaded: (version: string) => void
  failed: (message: string) => void
}

export type UpdateContext = {
  db: Db
  updater: UpdaterPort
  /** Ristretto al proprio payload, come `emit` di `dataset-import`: il topic lo nomina l'handler. */
  emit: (status: UpdateStatus) => void
}

/** Cosa `index.ts` costruisce una volta e `handlers.ts` riceve nel contesto. */
export type UpdateService = {
  state: () => UpdateStatus
  check: () => Promise<UpdateStatus>
  download: () => Promise<UpdateStatus>
  install: () => void
}

/**
 * Il servizio, con il suo stato.
 *
 * Lo stato vive qui e non nel renderer perché ha **due** lettori che non si
 * incontrano: il topic, che porta i cambiamenti a chi è già in ascolto, e
 * `update.state`, che risponde a chi si è appena montato. Il controllo parte
 * all'avvio, cioè quasi sempre prima che la vista Impostazioni esista: senza
 * questa memoria il pallino resterebbe spento proprio nel caso per cui esiste.
 */
export function createUpdateService(ctx: UpdateContext): UpdateService {
  let status: UpdateStatus = { state: 'idle' }

  /**
   * La versione che sta già su disco, ricordata a parte da `status`.
   *
   * Il primo tentativo guardava `status.state === 'ready'` dentro `available`,
   * e non funzionava: premendo «Ricontrolla» il primo evento è `checking`, che
   * `status` lo sovrascrive — quando `available` arriva, il `ready` da
   * proteggere non c'è più. Provato nell'app, non dedotto: lo schermo tornava a
   * «Scarica» e il pallino si spegneva.
   */
  let downloaded: string | null = null

  const set = (next: UpdateStatus): void => {
    status = next
    ctx.emit(next)
  }

  ctx.updater.listen({
    checking: () => set({ state: 'checking' }),
    /**
     * Il bivio dei due mondi, ed è l'unico posto in cui `manual` nasce.
     *
     * Dove l'app sa installarsi da sé lo stato è `available` e il bottone
     * scarica; dove no è `manual` e il bottone apre la pagina. Il documento 2
     * §4.12 li disegna come due righe diverse della stessa tabella, non come un
     * errore: «La versione 1.3.0 è disponibile.» e «Apri la pagina di
     * download».
     */
    available: (info) => {
      /**
       * Un pacchetto già scaricato non torna indietro.
       *
       * `checkForUpdates` riemette `update-available` ogni volta che il feed
       * porta una versione più alta di quella in esecuzione, e non sa né gli
       * importa che il pacchetto sia già su disco. Senza questa riga:
       * scarichi, leggi «è pronta» con «Riavvia e installa» e il pallino
       * acceso, premi «Ricontrolla» — e lo schermo torna a «è disponibile» con
       * «Scarica», il pallino si spegne, e la cosa da fare sparisce. Preso in
       * revisione, non provandolo.
       *
       * Confrontata la versione e non solo lo stato: se il feed ne porta una
       * ancora più nuova mentre questa è pronta, quella notizia va data.
       */
      if (downloaded === info.version) {
        // Ripristina, non ignora: dopo `checking` lo stato è `checking`, e
        // uscendo di qui senza scrivere resterebbe lì per sempre — «Controllo…»
        // che non finisce mai.
        set({ state: 'ready', version: info.version })
        return
      }

      set(
        ctx.updater.canInstallItself
          ? { state: 'available', version: info.version, notes: info.notes }
          : { state: 'manual', version: info.version, url: info.url },
      )
    },
    none: () => set({ state: 'none' }),
    progress: (percent) => set({ state: 'downloading', percent }),
    downloaded: (version) => {
      downloaded = version
      set({ state: 'ready', version })
    },
    /**
     * Il testo della libreria va nel log, non sullo schermo, e quale frase
     * italiana mostrare lo dice cosa stavamo facendo: l'evento `error` è lo
     * stesso per il controllo e per il download.
     */
    failed: (raw) => {
      console.error('[update]', raw)
      set({
        state: 'error',
        message:
          status.state === 'downloading'
            ? errorMessages.UPDATE_DOWNLOAD_FAILED()
            : errorMessages.UPDATE_CHECK_FAILED(),
      })
    },
  })

  return {
    state: () => status,

    check: async () => {
      // Lo stato `checking` lo emette l'evento dell'updater, non questa riga:
      // emetterlo anche qui lo manderebbe due volte a chi ascolta, e un
      // sottoscrittore non ha modo di distinguere un doppione da un secondo
      // controllo partito davvero.
      try {
        await ctx.updater.check()
      } catch (e) {
        console.error('[update] check', e)
        set({ state: 'error', message: errorMessages.UPDATE_CHECK_FAILED() })
      }
      return status
    },

    download: async () => {
      // Solo `available` scarica. `manual` no, ed è il punto della sua
      // esistenza: su una build che non sa installarsi il download riuscirebbe
      // e l'installazione fallirebbe dopo, cioè nel momento peggiore.
      if (status.state !== 'available') return status
      try {
        await ctx.updater.download()
      } catch (e) {
        console.error('[update] download', e)
        set({ state: 'error', message: errorMessages.UPDATE_DOWNLOAD_FAILED() })
      }
      return status
    },

    install: () => {
      /**
       * `manual` esce **prima** della guardia, e la prova l'ha trovato
       * cliccando.
       *
       * La guardia esiste per una ragione sola, che il documento 3 §8 scrive
       * per esteso: «Installare richiede il riavvio, quindi il servizio rifiuta
       * l'installazione se una lega è in stato `auction`». Aprire una pagina
       * nel browser non riavvia niente. Con il controllo davanti a tutto, su
       * una build non firmata il bottone «Apri la pagina di download» durante
       * un'asta rispondeva «installare riavvia l'app» — un rifiuto sbagliato
       * che per di più dava una ragione falsa.
       */
      if (status.state === 'manual') {
        ctx.updater.openDownloadPage(status.url)
        return
      }
      if (status.state !== 'ready') return

      // Rivalidato qui e non solo nell'interfaccia: la regola 2 del CLAUDE.md.
      // Fra il momento in cui il bottone si accende e il clic può passare
      // un'intera asta, e questo è il rifiuto che nessuno vede arrivare.
      const live = ctx.db
        .select({ name: league.name })
        .from(league)
        .where(eq(league.status, 'auction'))
        .get()
      if (live) raise('UPDATE_DURING_AUCTION', { name: live.name })

      ctx.updater.install()
    },
  }
}
