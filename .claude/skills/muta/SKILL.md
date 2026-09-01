---
name: muta
description: Rompe apposta le guardie di un file e verifica che i test se ne accorgano. Usare dopo aver scritto o modificato le funzioni pure di src/shared/domain.ts e i loro test — il CLAUDE.md lo impone («rompila apposta e rilancia i test») — oppure quando si vuole sapere se un test protegge davvero qualcosa.
version: 0.1.0
---

# Il giro delle mutazioni

Il `CLAUDE.md` lo dice in una riga: «Una guardia che non scatta mai è
indistinguibile da un dato sempre pulito. Dopo averne scritta una, rompila
apposta e rilancia i test: se passano lo stesso, il test non c'è.»

Questa skill rende il giro meccanico invece di riscriverlo ogni volta, e ci
mette dentro le quattro cose che un ciclo scritto a mano dimentica.

## Procedura

**1. Scrivi le mutazioni** in un file TSV nella cartella temporanea della
sessione — `descrizione`, una tabulazione, l'espressione per `perl -0pi -e`:

```
guardia a zero slot tolta	s/  if \(free <= 0\) return 0\n//
tiene da parte uno slot di troppo	s/\(free - 1\) \* minBid/free * minBid/
puntata minima ignorata	s/\(free - 1\) \* minBid/(free - 1)/
in revisione blocca lo stesso	s/severity === 'blocking'/true/
```

Una mutazione per invariante, e ognuna deve essere una modifica che **un lettore
distratto potrebbe fare davvero**: togliere una guardia, invertire un confronto,
scambiare `>` con `>=`, sostituire una costante con un letterale. Le mutazioni
assurde uccidono sempre e non dicono niente.

**2. Lancia:**

```
bash .claude/skills/muta/muta.sh src/shared/domain.ts /tmp/…/mutazioni.tsv src/shared/domain.test.ts
```

Il terzo argomento è facoltativo: senza, gira tutta la suite. Con, gira solo quel
file ed è molto più veloce — ma attenzione, il totale che leggi è quello del file
solo, non quello della suite.

**3. Leggi le tre risposte possibili.**

| Esito | Cosa vuol dire |
|---|---|
| `uccisa (N falliti)` | la guardia esiste e i test la vedono |
| `SOPRAVVISSUTA` | nessun test se ne accorge, e va capito perché |
| `FILE SCARTATO` | la mutazione ha rotto la sintassi: Vitest ha buttato il file e il totale è calato. **Non è una guardia inerte, è una prova non eseguita** |
| `ESPRESSIONE NON APPLICATA` | il `perl` non ha combaciato e il file è rimasto identico: la mutazione non è mai avvenuta |

Lo script ripristina il file a ogni giro e alla fine, anche se lo interrompi.

## Quando una mutazione sopravvive

Non è automaticamente un test da aggiungere. Il `CLAUDE.md` elenca quattro modi
in cui questa prova mente, e due si riconoscono proprio qui:

- **La guardia è irraggiungibile per costruzione.** Una riga che nessun dato può
  raggiungere perché una riga precedente la copre già. Il rimedio non è un test
  più contorto: è togliere la riga, o far dire alla funzione quello che intende
  davvero. È successo a `permutationOf` in T11 e a `planCells` in T12.
- **Il caso non esiste nei dati.** La mutazione fallisce come deve, e la guardia
  non scatta su nessun giocatore vero. Il fissato va preso dal dataset costruito,
  non inventato — è la lezione di T10, `hasHistory({})`.

Se invece manca davvero un caso al limite, scrivilo: quasi sempre è un confronto
sul filo, il valore esatto in cui `>` e `>=` si distinguono.
