---
name: chiudi-fase
description: Il rituale di chiusura di un task o di una fase della roadmap — revisione, pacchetto provato, trappole registrate, commit separati. Usare quando il lavoro di un task compila e gira e si sta per committare, o quando l'utente dice «chiudiamo», «rivedi» o «facciamo il commit».
disable-model-invocation: true
version: 0.1.0
---

# Chiudi un task, chiudi una fase

`/apri-task` mette in fila i passi di apertura. Questi sono quelli di chiusura, e
oggi stanno sparsi in tre sezioni lontane del `CLAUDE.md` — «Come lavoriamo»,
«Test», la tabella delle trappole — quindi si ricompongono a memoria, che è il
modo in cui si saltano.

**Il lavoro compila e i test passano: questo è il punto di partenza, non la
fine.** Il `CLAUDE.md` lo dice così: «Che compili e giri non basta.»

## 1. Prima di chiamare la revisione, ferma le mani

`revisore-fase` rivede un albero che deve stare fermo. Se cambia mentre legge
deve riverificare da capo ogni citazione — è successo in T11 e in T12, e in
entrambi i casi l'ha segnalato lui.

Quindi: **prima** si finisce di scrivere, **poi** si chiama. E mentre gira non si
tocca niente. Lanciare l'app non conta come toccare: costruisce dentro `out/`,
non muove il sorgente.

## 2. La revisione

L'agente `revisore-fase`, e nel prompt vanno tre cose che lui non può indovinare:

- **l'elenco dei file toccati**, compresi quelli **nuovi**: non stanno in
  `git diff` e senza nominarli li rivede a metà;
- **cosa hai già verificato** — typecheck, test, build, l'app eseguita — così non
  te lo riporta come mancanza;
- **le decisioni che vuoi contestate**, quelle prese oltre la lettera del
  documento. Se non le dichiari, le legge come se il documento le chiedesse.

Poi: **ogni rilievo va verificato contro il codice prima di accettarlo.** In T1
sette su dieci erano plausibili e falsi. Verificare vuol dire eseguire.

Se il task ha toccato il copy dell'interfaccia, l'agente `revisore-copy` costa
una frazione e guarda la sola cosa che sfugge da tre task di fila.

## 3. Il pacchetto, se chiudi una fase

Il `CLAUDE.md`: «Alla fine di ogni fase, **produci un pacchetto installabile e
provalo**, non aspettare la fine del progetto.» Si fa con `/prova-pacchetto pack`
— che è riservato all'invocazione dell'utente, quindi va chiesto a lui.

Prova quello che **solo** il pacchetto può provare, e dillo esplicitamente:

- `better-sqlite3` si carica sotto l'ABI impacchettata — vale solo se hai
  istanziato, `require` riesce anche con l'ABI sbagliata;
- l'`asarUnpack` è completo;
- il database è `Fanta Help` e **non** `Fanta Help (dev)`: se coincidono, la
  separazione dei dati utente è saltata;
- i fogli di stile si risolvono sotto `file://`.

Il database del pacchetto è quello **vero**. Non creare leghe di prova lì dentro,
e non provare mai un passo irreversibile: gli stati vanno solo avanti.

## 4. Le trappole nuove

Se il task ne ha aperta una, va nella tabella del `CLAUDE.md`: è l'unico posto
dove sopravvive alla sessione. Il criterio per distinguerla da una nota qualsiasi
è che **non si annunci quando scatta** — compila, passa il typecheck, e sembra
fatta.

Un commit suo, come i precedenti: `CLAUDE.md: …`.

## 5. I commit

Uno per concetto, non uno per sessione. In T15 sono stati quattro: la decisione
in roadmap, un commento duplicato che veniva da T14, il task, la trappola.

Due regole meccaniche:

- **`git add` e `git commit` in due chiamate separate.** Se un `add && commit`
  viene negato dai permessi non è stato eseguito niente, nemmeno la parte prima
  della `&&`: l'indice resta com'era e il commit dopo prende quello vecchio.
  Sembra riuscito e gli mancano i file.
- **Guarda `git status` dopo ogni negazione**, e prima del primo commit. I file
  nuovi non stanno in `git diff`. L'hook `untracked-guard.sh` avvisa, ma avvisa e
  basta.

## 6. Prima di dire che è finito

Dillo con i numeri che hai davvero eseguito — quanti test, quale build, cosa hai
guidato nell'app — e dichiara **cosa non hai provato e perché**. Un elenco di
verifiche senza il suo buco è indistinguibile da un elenco completo.
