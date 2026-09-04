---
name: misura-layout
description: Misura le taglie vere di una schermata nell'app in esecuzione — altezza di riga, quante righe entrano, corpi calcolati — a più dimensioni di finestra. Usare dopo aver toccato l'impaginazione o le taglie di un componente, e ogni volta che si sta per scrivere «entrano N righe» senza averle contate.
disable-model-invocation: true
version: 0.1.0
---

# Misura il layout, non calcolarlo

Il `CLAUDE.md` porta questa riga fra le trappole: **le taglie di un layout si
misurano, non si calcolano**. È costata T15, tre volte di fila e sempre nella
direzione che rileggendo il codice non si vede:

| Stimato a mente | Misurato |
|---|---|
| riga da 47px, undici visibili | **59px, otto** |
| dodici squadre sul televisore | **sei** |
| primo gradino «uguale a oggi» | **44.5px contro 59** — più fitto, non uguale |

La causa è sempre la stessa: sommare `padding` + corpo + interlinea ignora come
il flex distribuisce lo spazio davvero, e il numero sbagliato compila, passa il
typecheck e sembra fatto.

## Prima

Serve l'app **già in esecuzione** con la porta DevTools aperta: `/prova-pacchetto
dev`. Questa skill non la lancia — non deve, perché la si usa più volte di
seguito mentre si aggiusta un valore, e ricostruire ogni volta costa più della
misura.

Dopo aver cambiato un valore: ricostruisci con `npm run build` e ricarica il
renderer (`location.reload()`), altrimenti stai rimisurando il CSS di prima. È
l'errore più facile di tutto il giro.

## La misura

Con `mcp__electron-devtools__evaluate_script`. Il numero che conta quasi sempre
non è l'altezza di una riga ma **quante ne entrano**, perché è quello che
l'utente vede:

```js
() => {
  const ul   = document.querySelector('<selettore della lista>')
  const rows = [...document.querySelectorAll('<selettore delle righe>')]
  const h    = rows[0]?.getBoundingClientRect().height
  return JSON.stringify({
    viewport: innerWidth + 'x' + innerHeight,
    rowHeight: h ? +h.toFixed(1) : null,
    listHeight: ul ? +ul.getBoundingClientRect().height.toFixed(1) : null,
    fits: ul && h ? Math.floor(ul.getBoundingClientRect().height / h) : null,
    font: rows[0] ? getComputedStyle(rows[0].querySelector('<selettore del testo>')).fontSize : null,
  })
}
```

## Le dimensioni da provare

Con `mcp__electron-devtools__emulate`, campo `viewport`, forma
`<larghezza>x<altezza>x1`. **`resize_page` non funziona**: chiede
`Browser.getWindowForTarget`, che Electron non implementa, e risponde con un
errore di protocollo che sembra un server MCP rotto.

| Dimensione | Perché |
|---|---|
| `1440x872x1` | La finestra come si apre — `main/index.ts` dice 1440×900, e 872 è l'altezza utile tolta la barra del titolo su macOS. È la sola misura che si prova tutti i giorni |
| `1100x672x1` | La finestra più stretta che l'app permette (`minWidth` 1100). Sotto la board delle rose cede alla lista di righe: è il confine da provare quando si tocca l'asta |
| `1280x800x1` | Un portatile a schermo intero |
| `1920x1080x1` | Il televisore del modo proiezione. Provala **vera**: a 1040 il conto tornava a undici righe e a 1080 a dodici |

## Il confronto che serve davvero

Una taglia non è giusta o sbagliata da sola: lo è rispetto a quella accanto. In
T15 il vincolo era «in proiezione entrano almeno tante squadre quante in
normale, e il carattere è più grande», e si verifica misurando **le due modalità
alla stessa dimensione** — non una sola due volte.

Se il numero manca il bersaglio per poco, guarda il rapporto prima di rifare le
taglie: a 1920×1080 la lista conteneva 11,99 righe. Un pixel di `padding` per
lato in meno ha comprato la dodicesima squadra senza che si veda.

## Alla fine

**Il numero misurato va nel commento, accanto ai valori.** Una scaletta di
taglie senza le misure che la giustificano è indistinguibile da una scelta a
caso, e il prossimo che la tocca ricomincia a calcolare a mente.
