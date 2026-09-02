---
name: prova-servizio
description: Esegue un servizio del main contro un database vero, in memoria e sotto l'ABI di Electron. Usare quando si è appena scritto o modificato un servizio in src/main/services/ e si vuole vedere cosa fa davvero — i rifiuti con i loro messaggi, le transazioni, le invarianti — che i test su Node non possono toccare.
version: 0.1.0
---

# Provare un servizio del main

I test girano su Node e `better-sqlite3` è compilato per l'ABI di Electron:
importare il database in un test muore con `NODE_MODULE_VERSION mismatch`. Il
documento 6 §2 chiama quel vincolo il guardrail, ed è giusto — ma vale per
Vitest, non per te.

Il documento 6 §5 indica l'altra strada in una riga: «se in futuro servissero
test d'integrazione veri sul livello dati, la strada pulita è uno script separato
eseguito sotto Electron, non Vitest. Va tenuto fuori dal ciclo veloce dei test».
Questa skill è quello script.

**Serve perché ci sono difetti che vivono solo qui.** In T12 e T13 sono usciti da
questo harness e da nessun'altra parte: un rifiuto che diceva «ha già 0 portieri»,
un tetto per ruolo che tollerava un eccedente ereditato, una guardia che
confrontava la stagione sbagliata. Nessuno di questi rompe un tipo, e nessuno può
essere provato da una funzione pura.

## Procedura

**1. Copia il modello** nella cartella temporanea della sessione:

```
cp .claude/skills/prova-servizio/harness.ts /tmp/…/scratchpad/h.ts
```

Porta già il database in memoria con lo schema vero, due stagioni, una squadra di
Serie A, un aiutante `player()` per seminare giocatori e un aiutante `prova()`
che stampa gli esiti senza fermarsi al primo rifiuto.

**2. Scrivi le prove in fondo**, importando i servizi con percorsi assoluti — il
file vive fuori dal progetto e gli alias `@shared/…` non lo raggiungono.

**3. Lancia:**

```
bash .claude/skills/prova-servizio/run.sh /tmp/…/scratchpad/h.ts
```

**Un servizio asincrono non si aspetta al primo livello.** `run.sh` impacchetta
l'harness in CJS con esbuild, e un `await` fuori da una funzione fallisce con
«Top-level await is currently not supported with the "cjs" output format» — un
errore del bundler, non del codice, che sembra un problema di configurazione. I
servizi che aprono un dialogo o toccano il filesystem sono `async`: avvolgi le
prove in `void (async () => { … })()` e fai che `prova()` aspetti quello che
riceve. Gli `import` restano al primo livello, li issa esbuild.

**Due macchine in un harness solo.** Un giro fra due installazioni — export di
qua, import di là — si prova costruendo un secondo `new Database(':memory:')`
nello stesso file, con le stesse migrazioni e gli stessi `identity_key` ma **id
diversi**: è quella differenza a fare la prova, e con id uguali non prova niente.
Così T18 ha verificato che ricristallizzando sull'altra macchina esce l'impronta
di partenza.

## Cosa provare, che i test non provano

Non ripetere qui l'aritmetica: quella sta nelle funzioni pure e ha già i suoi
test. Qui si prova il **contorno**, che è dove il servizio può sbagliare da solo:

- **Il rifiuto giusto, non solo che rifiuti.** Stampa il codice *e* il messaggio.
  Un vincolo dello schema che scatta prima della tua guardia arriva come
  `UNKNOWN`, e la differenza si vede solo leggendo la riga.
- **Le frasi con i numeri dentro.** «Ha già 1 difensori» e «ha già 0 portieri»
  compilano benissimo.
- **Le porte di stato.** Forza uno stato e riprova: le invarianti 9, 13 e 16
  vivono lì, e nessuna interfaccia sa ancora portarci una lega.
- **Il rollback.** Conta le righe prima e dopo un'operazione rifiutata a metà.
- **Le sequenze.** Riordini, undo, turni: l'ordine finale è quello atteso solo se
  l'inverso è davvero l'inverso.

## Alla fine

L'harness è usa e getta e sta nella cartella temporanea, non nella repo: non è
una suite, è uno strumento per guardare. Quello che scopre, però, o diventa un
test su una funzione pura, o diventa una riga di commento nel servizio che dice
perché quel controllo esiste.
