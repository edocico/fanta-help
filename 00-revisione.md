# Fanta-Help — Revisione dei documenti 1–4

> **STATO: CHIUSA.** Tutti i 31 rilievi sono stati applicati ai documenti 1–4, incluse le cinque decisioni della sezione finale. Questo documento resta come registro di cosa è stato trovato e perché, **non è una lista di cose da fare**.
>
> Alcuni rilievi sono stati risolti diversamente da come proposto qui, perché nel frattempo FBref è rientrato come fonte facoltativa: i rilievi 1, 2 e 3 sono stati risolti recuperando il dato invece di togliere il campo. Il rilievo 5 resta risolto come scritto, perché xG e xA non hanno più nessuna fonte.

31 rilievi. Sette richiedevano una decisione dell'autore, gli altri erano correzioni dirette.

Severità: **A** rompe qualcosa se non corretto · **B** lacuna di progetto da colmare prima di scrivere codice · **C** dettaglio.

---

## Parte 1 — Dati promessi che nessuna fonte ci dà più

Il documento 4 ha eliminato FBref, con una motivazione giusta. Ma il documento 1 era stato scritto quando FBref c'era ancora, e promette colonne che ora non hanno più origine. Questa è la categoria più grave: sono campi che resterebbero vuoti per sempre senza che nessuno se ne accorga fino a quando l'interfaccia mostra una colonna di trattini.

Le uniche colonne disponibili sono quelle del file statistiche di Fantacalcio.it: `Pv Mv Fm Gf Gs Rp Rc R+ R- Ass Amm Esp Au`.

**1 · A · `minutes` non esiste.** Schema doc 1 riga 237, promesso nello scope riga 38. Il file statistiche non ha i minuti giocati. Nessuna fonte residua li fornisce.
→ Togliere la colonna e la promessa.

**2 · A · `minutes_share` non è calcolabile.** Doc 1 §6, formula `minuti / (presenze × 90)`. Dipende dal campo precedente.
→ Togliere la metrica. La sua funzione, distinguere il titolare dal subentrante, la copre già `Pv`: le partite *a voto* escludono già chi è entrato per dieci minuti senza prendere voto.

**3 · A · `clean_sheets` non esiste.** Schema riga 242, promesso riga 38. Il file dà `Gs`, i gol subiti totali, da cui non si ricavano le partite senza subire gol.
→ Sostituire con `goals_conceded_per_game` = `Gs / Pv`, calcolato. È il dato che serve davvero per valutare un portiere col modificatore.

**4 · A · `penalty_share` non è calcolabile.** Doc 1 §6, formula `rigori_calciati / rigori_squadra`. I rigori totali della squadra non sono in nessun file.
→ Togliere. Il documento 4 ha già risolto il problema meglio, con il campo `penaltyTaker` designato a mano.

**5 · A · `xg` e `xa` resterebbero sempre nulli.** Schema righe 251-252, erano di FBref.
→ Togliere dallo schema. Rimetterli quando e se FBref rientra.

**6 · B · `Pv` non è "presenze".** È *partite a voto*, cioè le giornate in cui il giocatore ha effettivamente preso un voto. Chiamarlo `presences` è impreciso e porta a interpretazioni sbagliate a valle.
→ Rinominare `votes` o `matches_rated`, e documentare che è la base giusta per l'affidabilità: misura in quante giornate ti ha davvero portato punti.

---

## Parte 2 — Contraddizioni tra documenti

**7 · A · La chiave di identità ha due formati incompatibili.** Doc 1 §7 usa `"lautaro-martinez-1997-08-22"`, doc 4 §5 usa `"fc-2170"`.
→ Vince `fc-<sourceId>`, e per una ragione che non avevo messo a fuoco: **il file quotazioni non contiene le date di nascita**. Una chiave costruita su nome più data di nascita non è generabile durante un import XLSX, che è la strada di riserva su cui l'app deve poter contare. La chiave basata sull'`Id` del listone si genera da entrambe le fonti.

**8 · A · Doc 1 dice ancora che l'auto-update è fuori dalla v1.** Tabella "Fuori dalla v1", riga 70. Contraddice il documento 3 §8 e il documento 2 §4.12.
→ Spostare tra le funzioni incluse.

**9 · B · Doc 1 elenca ancora il nome della repo del dataset tra i punti aperti.** Riga 513, deciso nel documento 4 §10.
→ Chiudere.

**10 · C · `dataset_version` ha due formati.** Doc 1 usa `'2026-27.4'`, il manifest del doc 4 usa `"v4"`.
→ Unificare su `v4`, con la stagione già in `season_id`.

---

## Parte 3 — Bug nello schema

**11 · A · Chiave esterna circolare senza `ON DELETE`.** `league.current_turn_team_id` punta a `fanta_team(id)` senza clausola. Cancellare una squadra che è di turno fallisce con una violazione di vincolo, e il messaggio d'errore non dirà perché.
→ `REFERENCES fanta_team(id) ON DELETE SET NULL`.

**12 · A · Il riordino delle squadre viola il vincolo di unicità.** `UNIQUE (league_id, order_index)` è immediato in SQLite, non differibile. Scambiare due squadre di posto con due `UPDATE` successivi fallisce sul primo.
→ Il servizio `team.reorder` deve riscrivere tutti gli indici in una transazione passando per valori temporanei negativi. Va scritto nel documento 3, altrimenti Claude Code ci sbatte contro e "risolve" togliendo il vincolo.

**13 · A · Cancellare una squadra cancella i suoi acquisti in silenzio.** `purchase.fanta_team_id ... ON DELETE CASCADE`. In `setup` è corretto, in `auction` è perdita di dati con un clic.
→ Invariante: una squadra si cancella solo in `setup` e `pre_auction`.

**14 · A · Niente garantisce che un acquisto riguardi un giocatore della stagione della lega.** `purchase.player_id` punta a `player(id)`, che è per stagione, e `league.season_id` è un'altra colonna. Nulla impedisce di assegnare a una lega 2026-27 un giocatore della stagione precedente.
→ Invariante da aggiungere e da verificare nel servizio.

**15 · B · Manca la colonna dei pesi del punteggio.** Doc 1 §6 e doc 3 §10 dicono entrambi che stanno su `league` come JSON, ma il DDL non ce l'ha.
→ Aggiungere `scoring_weights TEXT`.

**16 · B · Manca il rigorista designato su `player`.** Il documento 4 lo aggiunge al dataset con `penaltyTaker` e `penaltyTakerSource`, ma non ha una destinazione nello schema.
→ Aggiungere `penalty_taker INTEGER NOT NULL DEFAULT 0` e `penalty_taker_source TEXT`.

**17 · B · Manca il flag del modificatore di difesa.** Doc 1 §6 dice che chi lo usa valuta i difensori diversamente, ma la lega non ha modo di registrare se è attivo. Non è un peso del punteggio, è una regola del regolamento.
→ Aggiungere `defense_modifier INTEGER NOT NULL DEFAULT 0`, soggetto all'invariante 13 come le altre regole.

**18 · C · `player_season_stat.season_id` non ha chiave esterna, e non deve averla.** Le statistiche coprono stagioni che non hanno una riga in `season`, perché quella tabella contiene solo le stagioni con un listone importato.
→ È corretto così, ma va scritto nel commento. Senza, qualcuno "sistemerà" aggiungendo il vincolo e romperà tutto lo storico.

**19 · C · `convenience` divide per la quotazione senza guardia.** Doc 1 §6.
→ Guardia sullo zero.

---

## Parte 4 — Lacune di progetto

**20 · A · L'import XLSX non sa a quale stagione appartiene.** Doc 4 §6 descrive il parser ma non dice come si determina `season_id`. Il file quotazioni non contiene l'anno in modo affidabile, e se l'utente importa senza aver mai scaricato un dataset non esiste nessuna riga in `season`.
→ L'import deve chiedere o far confermare la stagione, e creare la riga `season` se manca.

**21 · A · La vista Giocatori non sa quale stagione mostrare.** Doc 2 §3 la dichiara "accessibile sempre, indipendente dalla lega", ma più stagioni coesistono nel database e nessuna regola dice quale si vede.
→ Serve un selettore di stagione, con predefinita la più recente importata, e l'aggancio automatico alla stagione della lega quando ce n'è una aperta.

**22 · A · Chi fa passare la lega da `auction` a `review`?** Nessun canale nel documento 3 §"I canali". C'è `league.setStatus` generico, ma le transizioni di stato hanno effetti collaterali diversi tra loro e un canale generico li nasconde.
→ Canali espliciti: `auction.start`, `auction.close`. Le transizioni non sono un aggiornamento di campo.

**23 · B · Cambiare il giocatore di un acquisto durante la revisione tocca due invarianti insieme.** L'unicità del giocatore nella lega e la corrispondenza tra `slot_role` e `role_classic`. Sostituire un attaccante con un difensore richiede di cambiare anche lo slot.
→ Il servizio deve ricalcolare `slot_role` dal nuovo giocatore nella stessa transazione, non lasciarlo all'interfaccia.

**24 · B · Il filtro "solo titolari" non ha una definizione.** Doc 2 §4.4.
→ Fissarla: `Pv ≥ 25` sull'ultima stagione disponibile. Un numero arbitrario dichiarato è meglio di un numero arbitrario nascosto nel codice.

**25 · B · `reliability` divide per le giornate totali senza dirlo.** Sono 38, ma non è scritto da nessuna parte, e il valore penalizza chi è arrivato a gennaio.
→ Fissare 38 come costante nominata e annotare il limite noto nella scheda giocatore.

**26 · B · La formula della puntata massima si rompe a zero slot liberi.** `crediti − (slot_liberi − 1) × min_bid` con `slot_liberi = 0` restituisce `crediti + min_bid`.
→ Guardia esplicita: a rosa completa la puntata massima è zero e la squadra sparisce dal selettore, come già previsto dal documento 2 §7.

**27 · B · Il token del dataset non compare nel documento 3.** Il documento 4 §9 lo introduce, ma la sezione Sicurezza del documento 3 parla solo dell'host consentito.
→ Aggiungere: iniezione da variabile d'ambiente in fase di build, mai nel sorgente, e comportamento dell'app quando il token è assente o scaduto (deve degradare all'import XLSX, non bloccarsi).

**28 · C · I backup crescono all'infinito.** Doc 3 §5 li crea prima di ogni import e di ogni cristallizzazione, senza politica di conservazione.
→ Tenere gli ultimi dieci.

**29 · C · L'import del listone è bloccato durante l'asta ma non durante la revisione.** Doc 2 §7. Cambiare le quotazioni mentre si riconciliano i prezzi pagati è altrettanto sbagliato.
→ Estendere il blocco a `review` e `closed`.

**30 · C · `F11` per il modo proiezione confligge con la scorciatoia di schermo intero.** Doc 2 §6.
→ Spostare su `Ctrl/Cmd+P`.

**31 · C · `season.source` diventa ambiguo dopo due import di origine diversa.** Un dataset scaricato seguito da un XLSX manuale lascia un solo valore per due provenienze.
→ Registrare l'ultimo import e basta, dichiarandolo nel commento.

---

## Cosa serve da te

Cinque rilievi hanno una risposta ovvia che applico senza chiedere. Questi invece sono decisioni:

**a. Le presenze diventano "partite a voto".** Rilievo 6. Cambia il nome della colonna e la sua interpretazione in tutta l'interfaccia. È più corretto, ma è un vocabolario diverso da quello che forse usate tra voi.

**b. Il modificatore di difesa entra nella configurazione della lega.** Rilievo 17. Lo usate? Se sì il campo serve e cambia i pesi predefiniti per difensori e portieri. Se no, è una colonna in più che non guarderà nessuno.

**c. La soglia dei titolari a 25 partite a voto.** Rilievo 24. Su 38 giornate è circa due terzi. Va bene o la vuoi più alta?

**d. Il selettore di stagione nella vista Giocatori.** Rilievo 21. Serve davvero poter guardare i giocatori di una stagione passata, o l'app mostra sempre e solo l'ultima importata? La seconda è più semplice e forse sufficiente.

**e. Cosa fa l'app se il token del dataset non funziona.** Rilievo 27. Propongo che lo dica una volta e passi in silenzio all'import manuale, senza riprovare a ogni avvio.

---

## Quello che regge

Per equilibrio, le parti che ho cercato di rompere e non si sono rotte:

- La separazione tra dati di riferimento e dati utente tiene su tutti i percorsi di import e reimport.
- Il modello degli snapshot versionati e non sovrascrivibili non ha stati impossibili.
- La scelta di non persistere lo stato del rilancio elimina davvero il recupero sessione: ogni acquisto è una transazione singola e non esiste nulla da perdere.
- La cascata di riconciliazione del documento 4 copre i casi reali, incluso quello degli omonimi.
- Il flusso di assegnazione a tre `Invio` regge anche i casi limite della tabella del documento 2, perché ognuno blocca prima della scrittura e lascia lo stato del pannello intatto.
