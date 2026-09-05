/**
 * Le costanti che `electron.vite.config.ts` sostituisce a build nel bundle del
 * main. Non esistono a runtime come variabili: il `define` di Vite le riscrive
 * nel sorgente prima che parta, quindi qui si dichiarano e basta.
 */

/**
 * Se questa build porta un'identità di firma per macOS.
 *
 * **Non** «se l'app sa aggiornarsi da sé»: quella è la domanda a valle, e la
 * risponde `index.ts` mettendoci accanto la piattaforma su cui l'app gira. La
 * ragione della divisione sta accanto al `define`, che è dove il valore si
 * decide.
 */
declare const __MAC_SIGNED__: boolean
