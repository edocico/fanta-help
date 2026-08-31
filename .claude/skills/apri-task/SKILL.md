---
name: apri-task
description: Apre un task della roadmap di fanta-help leggendo soltanto i documenti che quel task indica. Usare quando si inizia un task ("facciamo T2", "apriamo il task 5", "/apri-task T13") o per rileggere l'ambito e il criterio di completamento di un task in corso.
version: 0.1.0
---

# Apri un task della roadmap

Il `CLAUDE.md` dice: «Leggi solo quello indicato dal task, non tutti.» Il
documento 5 lo motiva: dare tutti i documenti a ogni sessione riempie il
contesto di roba irrilevante e **peggiora il risultato**. Questa skill rende
meccanica quella disciplina, invece di lasciarla alla buona volontà.

L'argomento è il task: `T2`, `2`, `T13` sono tutti validi.

## Procedura

**1. Leggi la riga del task.** In `docs/05-roadmap-claude-code.md`, trova la
sezione `### T<n> · <titolo>`. Estrai: la riga `**Documenti:**`, il corpo, il
`**Fatto quando:**` e l'eventuale `**Attenzione:**`.

**2. Leggi il `CLAUDE.md`.** Sempre, per intero. È corto ed è l'unica memoria
che attraversa le sessioni.

**3. Leggi *solo* i documenti indicati**, e solo le sezioni indicate. La riga
`**Documenti:** 3 (§2, §7)` significa il file `03-architettura.md`, sezioni 2 e
7. Non aprire gli altri. Se durante il lavoro serve davvero un altro documento,
aprilo allora e dì perché.

**4. Controlla se il documento 6 innesta qualcosa.** La tabella in
`docs/06-testing.md` §7 dice cosa aggiungere per task. Riguarda **T4, T5, T13 e
T17**: per quelli il documento 6 va letto anche se la roadmap non lo nomina,
perché è stato scritto dopo. Su T13 in particolare i test vengono **prima** dei
servizi: le funzioni pure sono la specifica.

**5. Verifica la deriva.** Se il documento del task descrive qualcosa che il
codice ha già superato, fermati e dillo prima di scrivere. L'agente
`deriva-documenti` fa questo controllo per intero.

**6. Riassumi prima di toccare il codice**, in questa forma:

> **T<n> · <titolo>**
> Ambito: due o tre righe.
> Documenti letti: elenco.
> Fatto quando: il criterio, copiato alla lettera.
> Attenzione: le trappole che la roadmap segnala per questo task.
> Dubbi: le ambiguità trovate, oppure «nessuno».

**7. Chiedi, se c'è un dubbio.** Il `CLAUDE.md` chiude così, e il documento 5
dice che vale la pena ripeterlo a ogni task: «Se una specifica è ambigua o
sbagliata, fermati e chiedi. Non indovinare e non "sistemare" silenziosamente
una scelta che sembra strana: quasi tutte le stranezze in questi documenti sono
deliberate e motivate.»

## Alla fine del task

Non chiudere in silenzio. Il `CLAUDE.md` chiede due cose:

- **Una revisione.** L'agente `revisore-fase` rilegge il lavoro contro le regole
  e contro il documento del task. Che compili e giri non basta.
- **Un pacchetto installabile provato**, alla fine di ogni *fase* — non alla
  fine del progetto. La skill `/prova-pacchetto` lo costruisce e lo lancia.

E se è saltata fuori una trappola nuova, aggiungila alla tabella del
`CLAUDE.md`: è l'unico posto dove sopravvive alla sessione.
