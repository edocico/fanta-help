# Fanta-Help — Documento 7: Design system

> Revisione 2. Riscritta dopo la ricerca sui riferimenti.
> Si applica in refactoring **dopo l'MVP**, quindi è scritta come una differenza rispetto a quello che esisterà.

---

## 1. Cosa cambia rispetto alla revisione 1

La ricerca ha confermato l'impianto — scuro, denso, ambra per il denaro, guidato da tastiera — e ha smentito cinque dettagli.

| Cambia | Perché |
|---|---|
| I dieci colori squadra | Erano scelti a occhio. Sostituiti con una palette verificata per le deficienze cromatiche, e con un **ordine di assegnazione** che dà a una lega di sei squadre il set verificato |
| L'altezza riga fissa a 36px | Carbon documenta 24/32/40/48 e tratta la densità come preferenza. Qui è meglio: **la densità segue la fase**, perché consultare e registrare hanno bisogni opposti |
| Archivo per le colonne numeriche | Mantenere cifre tabulari coerenti su tutta la matrice peso × larghezza di un variabile è un problema noto. Archivo resta per display e proiezione, le colonne passano a un carattere che le cifre tabulari le fa di mestiere |
| Il contrasto | Bianco pieno su nero pieno produce halation, che penalizza chi ha astigmatismo. Superfici alzate dal nero, testo non bianco |
| Il pannello rose a righe | Sleeper ha abbandonato la vista a lista per una board a griglia perché vedere tutto insieme dà il contesto su chi sta accumulando cosa. Diventa una board |

E ha aperto un conflitto: tre pretendenti per lo stesso giallo. Il denaro (revisione 1), l'informazione neutra (convenzione dei terminali finanziari), il fuoco (linee guida di accessibilità, dove il giallo è il colore più visibile).

**Risolto togliendo un pretendente.** L'ambra resta il denaro. Il fuoco è un anello bianco ad alto contrasto, che su queste superfici è altrettanto inequivocabile. Il colore dell'informazione neutra **non esiste**: quel ruolo lo fanno icona e parole.

Scartata anche la convenzione verde-rialzo / rosso-ribasso dei terminali: codifica una direzione, e qui non c'è nessuna direzione da codificare. I crediti residui sono un livello, il prezzo pagato è una quantità. Sarebbe una convenzione presa in prestito che non descrive niente.

---

## 2. I sei principi

**La densità è una funzione, e cambia con la fase.** Consultare seicento giocatori per ore e registrare un acquisto in tre secondi non chiedono la stessa cosa. Righe comode in preparazione, righe strette in asta. Non è una preferenza dell'utente: è lo stato della lega che la decide.

**Il colore è informazione o non c'è.** Due soli significati cromatici: l'ambra è denaro, il rosso è un problema. Il verde-acqua marca un tuo obiettivo. Il colore delle squadre identifica una squadra. Nient'altro è colorato, mai per gerarchia e mai per gradevolezza.

**Il colore non è mai l'unico portatore.** Sopra le sei squadre non esistono tinte tutte distinguibili sotto deficienza cromatica. Il nome della squadra e la sua posizione nella board sono sempre presenti e sono l'identificazione primaria; il colore accelera, non definisce.

**I numeri sono il contenuto.** Crediti, prezzi e puntata massima non sono etichette di qualcos'altro. Cifre tabulari sempre, e nella board e in proiezione una larghezza espansa che li fa leggere da lontano.

**Il movimento mostra un cambiamento.** Solo in risposta a un'azione, solo dove qualcosa è cambiato, mai all'ingresso di una vista.

**Niente contenitori attorno a contenuto già strutturato.** Una tabella è già una struttura. Metterla in una card con bordo, raggio e ombra aggiunge tre elementi visivi e zero informazione.

---

## 3. Colore

I **primitivi** sono la tavolozza grezza e non si citano mai nei componenti. I **semantici** sono quelli che i componenti usano, e sono il punto in cui shadcn si aggancia.

### Primitivi

```css
/* superfici — verde-nere, il campo di sera, ma alzate dal nero puro */
--pitch-950: #0B100E;   /* solo proiezione */
--pitch-900: #121A16;   /* sfondo applicazione */
--pitch-800: #18221D;   /* pannelli, barra laterale */
--pitch-700: #212E27;   /* superfici elevate, righe alterne, hover */
--pitch-600: #2C3B33;   /* bordi, separatori */
--pitch-500: #3C4E44;   /* bordi enfatizzati */

/* testo — non bianco pieno */
--chalk-50:  #E4EAE5;   /* cifre grandi, anello di fuoco */
--chalk-100: #D6DED8;   /* testo primario */
--chalk-400: #8FA096;   /* secondario, etichette di colonna */
--chalk-600: #62716A;   /* disabilitato, segnaposto */

/* significati */
--gold:      #E8B33D;   /* denaro, e solo denaro */
--gold-deep: #8A6E2A;   /* bordi e fondi legati al denaro */
--rust:      #A8483E;   /* non più disponibile */
--teal:      #4FB8A8;   /* è un tuo obiettivo */
--crimson:   #D06058;   /* violazione bloccante */
--moss:      #6FB584;   /* conferma, reparto completo */
```

Il fondo resta verde-nero e non grigio neutro: è il campo di sera, ed è il legame con il soggetto che impedisce all'interfaccia di somigliare a un terminale finanziario qualunque. La differenza è di pochi punti di tinta e si nota su tre ore.

`--chalk-100` su `--pitch-900` dà circa 13:1. È alto ma non massimo, ed è deliberato: il contrasto estremo del bianco puro su nero puro fa sanguinare il testo.

`--crimson` e `--moss` sono più chiari dei rossi e verdi che si userebbero su fondo chiaro. Su queste superfici i colori scuri collassano.

### Non esiste un colore d'avviso

Un ambra d'avviso e un ambra di denaro si confondono, e la confusione cade proprio sui numeri che devono restare inequivocabili.

Le anomalie non bloccanti si comunicano con **un'icona e un testo** in `--chalk-400`, senza colore. Le violazioni bloccanti usano `--crimson`. È una rinuncia deliberata a un colore semantico comodo, in cambio di un canale che non mente mai.

### I colori delle squadre

Le prime sei derivano dalla palette Okabe-Ito, disegnata perché resti distinguibile sotto deficienza cromatica, con adattamenti di luminosità per il fondo scuro. Le altre quattro sono aggiunte, e portano un avvertimento.

**Perché sei e non otto.** Okabe-Ito ha sette tinte più il nero. Il nero non è usabile su fondo scuro, e il giallo è già preso: è l'ambra del denaro, e la regola del §2 vieta di prestarlo. Restano sei posti. Il settimo (lime) e l'ottavo (violetto) non hanno un corrispondente nella palette e sono esattamente i due che rompono la garanzia — misurati in Lab sulle simulazioni di protanopia e deuteranopia, lime cade a ΔE 7,4 dall'arancio e violetto a ΔE 3,9 dal blu, contro un pavimento di 10,9 che la Okabe-Ito originale non scende mai:

| Squadre | Margine minimo | |
|---|---|---|
| fino a 6 | ΔE 14,7 | verificato |
| 7 | ΔE 7,4 | arancio / lime |
| 8 | ΔE 3,9 | blu / violetto |
| 9-10 | ΔE 3,9 | |

Cercare un ottavo migliore non serve: i candidati che massimizzano il margine tornano tutti gialli, cioè la tinta che la regola del denaro esclude. Quindi la palette resta questa, e a portare il peso oltre le sei squadre è la regola di ridondanza qui sotto — che è progettata per questo.

```css
/* set verificato — assegnate per prime, in quest'ordine */
--team-1:  #E89A3C;   /* arancio    */
--team-2:  #6FC3EC;   /* celeste    */
--team-3:  #3FAE83;   /* verde      */
--team-4:  #7E9DE8;   /* blu        */
--team-5:  #E8735A;   /* vermiglio  */
--team-6:  #D48FB5;   /* rosa       */

/* aggiunte — dalla settima squadra in poi */
--team-7:  #A9C34A;   /* lime       */
--team-8:  #B78FE0;   /* violetto   */
--team-9:  #C79B6B;   /* terra      */
--team-10: #9AA69F;   /* grigio     */
```

**L'ordine di assegnazione è parte del sistema.** Una lega di sei squadre o meno riceve il set verificato. Dalla settima in poi si entra in territorio dove nessuna palette regge, e il colore diventa un acceleratore invece che un identificatore. Non è un difetto da correggere più avanti: è il limite della cosa, ed è la ragione per cui le due regole qui sotto non sono facoltative.

**Regola di canale.** I colori squadra compaiono solo come **riempimenti**: barra verticale, pastiglia, intestazione di colonna. Mai come colore di un testo o di un numero. L'ambra compare solo come **testo**. Canali diversi, quindi `--team-1` accanto a una cifra ambra non genera ambiguità nemmeno se le tinte si somigliano.

**Regola di ridondanza.** Il nome della squadra è sempre adiacente al suo colore, e nella board la posizione della colonna è fissa. Chi non distingue due tinte legge il nome e conta le colonne.

### Semantici

I nomi che i componenti usano.

```css
--surface:          var(--pitch-900);
--surface-panel:    var(--pitch-800);
--surface-raised:   var(--pitch-700);
--line:             var(--pitch-600);
--line-strong:      var(--pitch-500);

--text:             var(--chalk-100);
--text-strong:      var(--chalk-50);
--text-muted:       var(--chalk-400);
--text-disabled:    var(--chalk-600);

--money:            var(--gold);
--unavailable:      var(--rust);
--targeted:         var(--teal);
--blocking:         var(--crimson);
--confirmed:        var(--moss);
--focus:            var(--chalk-50);
```

**Nessun componente cita mai un primitivo.** È la disciplina che tiene aperta la porta a un tema chiaro, e costa zero mantenerla.

---

## 4. Tipografia

Due famiglie, ognuna con un lavoro che l'altra non fa. Entrambe con licenza libera, quindi distribuibili nell'app.

**IBM Plex Sans** per interfaccia, tabelle e numeri in colonna. Ha cifre tabulari vere, distingue nettamente 1/l/I e 0/O, ed è disegnata per la densità: Carbon la usa esattamente per questo.

**Archivo** per titoli, cifre grandi e proiezione. È variabile con asse di larghezza, e quell'asse è la ragione della scelta: la stessa famiglia condensa in una colonna stretta e si espande su un tabellone.

Una sola famiglia non basta, perché l'asse di larghezza di Archivo è quello che rende la proiezione la stessa schermata ingrandita invece che un layout separato. Tre famiglie sarebbero una di troppo: un monospaziato per i numeri è la scelta dei terminali finanziari, ma le cifre tabulari di Plex fanno lo stesso lavoro senza aggiungere una voce.

### Scala

Stretta e bassa. La misura di lavoro è 13px, non i 14 del default di shadcn.

| Token | px | Famiglia | Uso |
|---|---|---|---|
| `--text-micro` | 11 | Plex | etichette di colonna, badge, pastiglie |
| `--text-sm` | 12 | Plex | secondario, note, età del dato |
| `--text-base` | 13 | Plex | tabelle, form, navigazione |
| `--text-body` | 15 | Plex | prosa, spiegazioni nella scheda giocatore |
| `--text-title` | 18 | Plex | intestazioni di pannello |
| `--text-heading` | 24 | Archivo | titolo di vista |
| `--num-sm` | 13 | Plex | numeri dentro le colonne |
| `--num-md` | 20 | Archivo | crediti nell'intestazione di colonna della board |
| `--num-lg` | 32 | Archivo | puntata massima |
| `--num-xl` | 56 | Archivo | proiezione |

Archivo entra dai 20px in su. Sotto, le sue cifre tabulari sulla matrice peso × larghezza non sono garantite, e il posto dove servono davvero è la colonna a 13px.

### Ruoli

| Ruolo | Famiglia | Peso | Larghezza | Altezza riga |
|---|---|---|---|---|
| Cifre in colonna | Plex | 500 | — | 1.2 |
| Cifre grandi | Archivo | 600 | 112 | 1.1 |
| Cifre in proiezione | Archivo | 700 | 125 | 1.0 |
| Interfaccia | Plex | 400 / 500 | — | 1.4 |
| Prosa | Plex | 400 | — | 1.5 |

`font-variant-numeric: tabular-nums` ovunque un numero stia in colonna o possa aggiornarsi. Senza, le colonne dei crediti ballano a ogni acquisto.

### Vietato

- **Maiuscolo spaziato** su etichette e intestazioni. Rallenta la lettura su una tabella a quindici colonne ed è il tic più riconoscibile delle interfacce generate.
- **Una parola sola evidenziata** dentro un titolo.
- **La freccia `→` appesa** al testo di bottoni e collegamenti.
- **Etichette sopra un contenuto che si spiega da sé.** Una cifra ambra accanto a un nome di squadra non ha bisogno di "crediti residui" sopra.

Il separatore `·` è ammesso solo nella barra di stato di una vista, per unire al massimo tre fatti dello stesso tipo. Fuori da lì è decorazione travestita da struttura.

---

## 5. Densità per fase

Non è una preferenza nelle impostazioni. È lo stato della lega che la decide, perché le due fasi hanno bisogni opposti e l'utente non dovrebbe doverci pensare.

| Contesto | Altezza riga | Perché |
|---|---|---|
| Consultazione, obiettivi, piani | 40px | si legge per ore, serve respiro |
| Revisione | 40px | si corregge con attenzione, non in fretta |
| Board d'asta, celle | 22px | 25 slot per dieci squadre devono stare insieme |
| Registro acquisti in asta | 32px | si scorre di colpo |
| Intestazione tabella | 32px | sempre, adesiva |
| Proiezione | 44px | si legge da tre metri |

Le altezze vengono dalla scala di Carbon (24/32/40/48), che le documenta e le motiva. La 22px della board è sotto la scala perché una cella contiene solo un cognome e un prezzo.

---

## 6. Spaziatura, raggio, elevazione

**Unità base 4px.** Scala 2, 4, 6, 8, 12, 16, 24, 32, 48. In un'app densa quasi tutto vive tra 4 e 12.

| Raggio | Dove |
|---|---|
| 0 | righe e celle di tabella, celle della board |
| 3px | pastiglie, badge |
| 4px | bottoni, campi, select — è il `--radius` di shadcn |
| 6px | pannelli, popover, dialog |
| 999px | solo i chip di filtro, perché la forma dice "rimovibile" |

**Elevazione senza ombre.** Un livello più alto è una superficie più chiara. L'unica ombra dell'applicazione sta sotto popover e dialog, che devono staccarsi da uno sfondo denso: `0 8px 24px rgb(0 0 0 / 0.45)`.

**Bordi** sempre 1px di `--line`. Il 2px esiste solo per il fuoco.

---

## 7. Movimento

Quattro animazioni in tutta l'applicazione. Non se ne aggiungono senza toglierne una.

| Cosa | Durata | Quando |
|---|---|---|
| Cella della board che lampeggia nel colore squadra | 400ms | dopo un'assegnazione |
| Cifra dei crediti che conta al nuovo valore | 200ms | quando cambia |
| Pannello di dettaglio che entra da destra | 150ms | apertura |
| Toast che sale dal basso | 120ms | comparsa |

Curva unica `cubic-bezier(0.2, 0, 0, 1)`.

`prefers-reduced-motion: reduce` disattiva tutto tranne il cambio di colore del lampeggio, che diventa istantaneo ma resta, perché porta informazione.

Nessuna animazione all'ingresso di una vista. Nessuna transizione al passaggio del mouse su righe e celle.

---

## 8. Fuoco

Sezione a sé perché **l'asta si registra senza mouse**, di sera, in penombra. Se il fuoco non è inequivocabile, il flusso a tre `Invio` non funziona.

```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
```

Anello bianco-gesso, non colorato: non deve poter essere confuso con un significato semantico né con un colore squadra. Le linee guida di accessibilità raccomandano il giallo come colore di fuoco più visibile, ma qui il giallo è il denaro, e su queste superfici il bianco-gesso è altrettanto inequivocabile.

`outline: none` senza un sostituto equivalente non è ammesso da nessuna parte, per nessun motivo.

Nel pannello di assegnazione il campo a fuoco porta **anche** un bordo sinistro di 2px, perché lì bisogna capire a colpo d'occhio a che passo del flusso si è arrivati.

---

## 9. Mappatura su shadcn/ui

La parte che fa risparmiare più tempo nel refactoring. shadcn scrive i suoi componenti contro un insieme fisso di variabili: definire le nostre e ignorare le sue significa sovrascrivere ogni componente a mano.

Sono **due** mappature, non una, e saltare la seconda è il modo più facile di rompere il refactoring senza vedere un errore.

**La prima è il namespace delle utility dell'app.** Tailwind genera `bg-pitch-800` e `text-chalk-dim` solo da variabili dichiarate in `@theme` sotto il prefisso `--color-`. I primitivi del §3 stanno in un `:root` nudo, dove Tailwind non guarda: senza questo blocco le classi che i componenti già usano — 71 occorrenze contate su `src/renderer` — smettono di risolvere in silenzio, e l'elemento resta senza colore invece di dare errore.

```css
@theme {
  --color-pitch-950: var(--pitch-950);
  --color-pitch-900: var(--pitch-900);
  --color-pitch-800: var(--pitch-800);
  --color-pitch-700: var(--pitch-700);
  --color-pitch-600: var(--pitch-600);
  --color-pitch-500: var(--pitch-500);

  --color-chalk-50:  var(--chalk-50);
  --color-chalk-100: var(--chalk-100);
  --color-chalk-400: var(--chalk-400);
  --color-chalk-600: var(--chalk-600);

  --color-line:      var(--line);
  --color-money:     var(--money);
  --color-taken:     var(--unavailable);
  --color-target:    var(--targeted);
}
```

**La seconda è il vocabolario di shadcn.**

```css
@theme {
  --color-background:           var(--pitch-900);
  --color-foreground:           var(--chalk-100);
  --color-card:                 var(--pitch-800);
  --color-card-foreground:      var(--chalk-100);
  --color-popover:              var(--pitch-800);
  --color-popover-foreground:   var(--chalk-100);

  --color-primary:              var(--chalk-100);
  --color-primary-foreground:   var(--pitch-900);
  --color-secondary:            var(--pitch-700);
  --color-secondary-foreground: var(--chalk-100);

  --color-muted:                var(--pitch-700);
  --color-muted-foreground:     var(--chalk-400);
  --color-accent:               var(--pitch-700);
  --color-accent-foreground:    var(--chalk-100);

  --color-destructive:          var(--crimson);
  --color-border:               var(--pitch-600);
  --color-input:                var(--pitch-600);
  --color-ring:                 var(--chalk-50);
}
```

**Il raggio non va in `@theme`.** Lo spazio dei nomi dei raggi è `--radius-*`: un `--radius` nudo non alimenta nessuna utility, viene scartato dalla build e non compare nel CSS costruito, quindi il difetto non si vede — si vede solo che ogni `rounded-md` è tornato ai 6px di default. Il valore base resta su `:root` perché i componenti di shadcn citano `var(--radius)` direttamente.

```css
:root {
  --radius: 4px;
}

@theme inline {
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 6px);
}
```

È la forma già in uso in `src/renderer/src/styles/base.css`, dove la trappola era stata scoperta e annotata: non è una preferenza, è l'unico modo in cui il §6 («4px — bottoni, campi, select») produce davvero 4px.

### La decisione da non ribaltare

**Il bottone primario non è ambra.** È bianco-gesso su fondo scuro.

Se il primario fosse ambra, l'ambra smetterebbe di significare denaro nel giro di una schermata, e cadrebbe l'unica convenzione cromatica che l'app chiede di imparare. Un'azione primaria si distingue per contrasto e posizione, che bastano.

L'ambra tocca un elemento interattivo in un solo punto di tutta l'applicazione: il campo del prezzo nel pannello di assegnazione, perché lì il valore digitato **è** denaro.

Niente `tailwind.config.js`: con Tailwind v4 i token vivono in `@theme` dentro il CSS e i primitivi in un `:root` sopra.

---

## 10. Componenti

Solo quelli che shadcn non copre o che qui hanno regole proprie.

### Sigla

L'interfaccia è piena di abbreviazioni, ed è inevitabile: una colonna larga 40px non può avere "Fantamedia" come intestazione. `Pv Mv Fm Qt FVM Gf Gs Rp Rc Ass Amm Esp Au`, i ruoli `P D C A`, gli undici ruoli Mantra, i codici delle squadre di Serie A. Chi gioca solo a Classic non ha mai visto un `Pc`, e chi entra nell'app la prima volta non ne conosce metà.

**La regola che rende la cosa praticabile: una sigla si spiega dove è definita, mai dove è usata.** L'intestazione di colonna, il badge, l'etichetta: sì. Le seicento celle sotto quell'intestazione: no. Un popover su ogni cella di una tabella lunga sarebbe la cosa peggiore che possiamo fare a questa interfaccia.

**Una sola fonte di verità**, in `src/shared/glossario.ts`:

```ts
export const glossario = {
  Pv:  { esteso: 'Partite a voto',  spiega: 'Giornate in cui ha preso un voto in pagella' },
  Mv:  { esteso: 'Media voto',      spiega: 'Media dei voti, senza bonus né malus' },
  Fm:  { esteso: 'Fantamedia',      spiega: 'Media dei voti con bonus e malus inclusi' },
  Qt:  { esteso: 'Quotazione',      spiega: 'Prezzo base al quale parte in asta' },
  FVM: { esteso: 'Fantavalore di mercato', spiega: 'Quanto conviene spendere al massimo' },
  Pc:  { esteso: 'Punta centrale',  spiega: 'Ruolo Mantra: attaccante che gioca al centro' },
} as const

export type Sigla = keyof typeof glossario
```

Il componente accetta solo chiavi del glossario:

```tsx
<Sigla nome="Fm" />
```

Siccome `nome` è tipizzato come `Sigla`, **una sigla senza voce nel glossario non compila.** È la stessa disciplina dei contratti IPC: il compilatore impedisce la divergenza invece di sperare che qualcuno se ne accorga.

**Espansione e spiegazione sono due cose diverse.** Sapere che `Fm` sta per "fantamedia" non dice cosa sia una fantamedia. Per questo le voci hanno due campi, e il popover li mostra entrambi.

**Trattamento visivo.**

| Stato | Cosa succede |
|---|---|
| A riposo | niente. Nessuna sottolineatura punteggiata: quindici sottolineature in una riga di intestazione sono rumore |
| Al passaggio del mouse | sottolineatura punteggiata di 1px in `--text-muted` subito, popover dopo 600ms |
| Al fuoco da tastiera | sottolineatura e popover immediati, nessun ritardo |
| Dopo il primo popover | i successivi si aprono senza attesa per 300ms, così scorrere le intestazioni per impararle funziona |

Il ritardo di 600ms serve a una cosa sola: attraversare la tabella col mouse non deve far apparire niente. Il popover arriva solo se ti fermi.

Popover su `--surface-panel`, raggio 6px, l'unica ombra dell'applicazione. Esteso in `--text` a 13px peso 500, spiegazione in `--text-muted` a 12px, larghezza massima 240px.

**Si spegne in asta.** Il popover segue la densità: modo comodo acceso, modo asta spento. Durante l'asta le sigle visibili sono solo le lettere dei ruoli e i codici squadra, di scarso valore, e una board da 250 celle non deve accendere popover mentre il puntatore la attraversa. Il pannello di riferimento resta disponibile.

**Niente attributo `title`.** Sembra la scelta ovvia ed è la sbagliata: ha un ritardo che non si controlla, non compare al fuoco da tastiera, e lo disegna il sistema operativo con uno stile che sfugge al design system. Si usa il Tooltip di shadcn, che è costruito su Radix e gestisce `aria-describedby` e il fuoco da tastiera, più un'espansione nascosta visivamente per i lettori di schermo.

**Il pannello di riferimento.** `?` apre già l'elenco delle scorciatoie. Diventa un pannello a due sezioni, scorciatoie e sigle, e la seconda elenca tutto il glossario. Un tasto, completo, senza cercare. È anche la risposta al fatto che a riposo la sigla non ha nessuna decorazione: chi non scopre il passaggio del mouse trova tutto lì.

**E dove c'è spazio, non si abbrevia.** L'intestazione di colonna della board scrive `218 crediti · max 205`, non `218 cr · max 205`. La sigla migliore è quella che non serve.

### Board delle rose

Il cambiamento strutturale della revisione 2. Sostituisce il pannello a righe.

**Squadre in colonna, slot in riga**, raggruppati per ruolo. Ogni colonna è una rosa completa, ogni cella è uno slot.

```
        Real Fanta   Bomber Team   Zona Cesarini   …
        218 · max 205  96 · max 84   31 · max 19
      ┌────────────┬─────────────┬───────────────┐
   P  │ Meret   14 │ Svilar   22 │ Carnesecchi 9 │
      │ Falcone  3 │ ─           │ Sportiello  2 │
      │ ─          │ ─           │ ─             │
      ├────────────┼─────────────┼───────────────┤
   D  │ Dimarco 31 │ Bastoni  24 │ Gatti      12 │
      │ …          │ …           │ …             │
```

- Intestazione di colonna: barra del colore squadra a piena larghezza, nome, poi crediti residui e puntata massima in ambra a `--num-md`.
- Celle piene: cognome a 12px e prezzo a destra in ambra a 11px. Altezza 22px.
- Celle vuote: un trattino in `--text-disabled`, nessun bordo.
- Gruppi di ruolo separati da una linea e dalla lettera del ruolo a sinistra.
- Reparto completo: la lettera del ruolo passa a `--confirmed`.
- Colonna della tua squadra: nome in grassetto e bordo laterale `--line-strong`.

Questo risolve quello che una lista di righe non risolve: si vede a colpo d'occhio chi sta accumulando attaccanti, chi è quasi pieno, chi ha ancora soldi. È il motivo per cui Sleeper ha abbandonato la vista a lista.

**Fallback a finestra stretta**: sotto i 1100px la board diventa una lista di righe con i pallini degli slot, come nella revisione 1. Non è la vista principale, è il ripiego.

### Tabella dati

Per consultazione, obiettivi, piani, revisione.

| Proprietà | Valore |
|---|---|
| Altezza riga | 40px (§5) |
| Intestazione | 32px, adesiva |
| Separatore | 1px `--line`, solo orizzontale |
| Righe alterne | `--surface-raised` al 40% |
| Hover | `--surface-raised` pieno, senza transizione |
| Padding cella | 8px orizzontale |
| Allineamento | testo a sinistra, numeri a destra, sempre tabulari |

Stati di riga:

- **Già acquistato**: opacità 45%, nessun hover, non selezionabile. Barra del colore della squadra che l'ha preso.
- **Nella tua lista**: punto `--targeted` di 6px prima del nome.
- **Indisponibile**: icona prima del nome, rientro previsto nel tooltip. Mai colorare tutta la riga.
- **Selezionata**: fondo `--surface-raised`, bordo sinistro 2px `--focus`.

Niente colonna di caselle di selezione: in questa app non esistono azioni di massa.

### Cifra

Componente dedicato, perché i numeri sono il contenuto.

```
<Cifra valore={218} tipo="denaro" dimensione="md" />
```

Sceglie la famiglia in base alla dimensione: Plex sotto i 20px, Archivo espanso sopra. Cifre tabulari sempre. Colore `--money` se `tipo="denaro"`. Anima il conteggio al cambio di valore in 200ms, non al primo montaggio.

Nessun numero dell'applicazione si scrive a mano dentro un `<span>`.

### Chip di filtro

Altezza 24px, raggio pieno, 11px peso 500.
Attivo: fondo `--surface-raised`, testo `--text`, x per rimuoverlo.
Inattivo: fondo trasparente, bordo `--line`, testo `--text-muted`.

Il filtro dei titolari è un campo numerico di Pv minime con un chip preimpostato a 25, non un interruttore con una soglia nascosta.

### Badge di ruolo

18px quadrati, 11px peso 600, fondo `--surface-raised`, testo `--text`. **Neutri.**

Valutata e scartata l'idea di usare i colori di dominio del Mantra (portiere giallo, difesa verde, centrocampo blu, trequarti viola, attacco rosso). È una convenzione reale che i giocatori già leggono sul listone, ma sono cinque colori in più che competono con le dieci tinte delle squadre e con l'ambra, in una tabella dove il ruolo è già filtrato e già scritto. La convenzione non vale il rumore.

I ruoli Mantra stanno sotto il nome come testo a 11px in `--text-muted`, non come badge: sono fino a tre e riempirebbero la riga.

### Pannello di assegnazione

Composito e specifico dell'asta. Tutti gli stati vanno specificati, perché è dove si passa la serata.

1. **Vuoto** — campo a fuoco, segnaposto "Cerca un giocatore".
2. **Con risultati** — primo risultato preselezionato, fondo `--surface-raised`.
3. **Giocatore scelto** — riga del giocatore fissata in alto, fuoco al prezzo, bordo sinistro sul campo attivo.
4. **Avviso indisponibilità** — riga tra giocatore e prezzo: icona, testo, età del dato in `--text-muted`. Non blocca e non sposta il fuoco.
5. **Violazione bloccante** — messaggio in `--blocking` sotto il campo che l'ha causata, bottone disattivato, fuoco dove sta l'errore.
6. **Protezione dalla conferma affrettata** — se il prezzo cambia tra la digitazione e la conferma, il bottone si riarma e richiede un secondo `Invio`. È il pattern che i tool di draft chiamano protezione dal rilancio, e serve perché sotto pressione si preme due volte.

Il campo del prezzo accetta il tastierino numerico senza modificatori: chi registra digita prezzi tutta la sera.

### Toast

In basso a sinistra, sopra il pannello di assegnazione. Dieci secondi, con "Annulla". Non ruba mai il fuoco. Massimo tre impilati, i più vecchi escono.

### Scorciatoie visibili

Ogni voce di menu e ogni azione con una scorciatoia la mostra accanto a sé, in `--text-muted` a 11px. Serve una sera sola, ma quella sera serve.

### Stato vuoto

Una riga di testo in `--text` e l'azione accanto, sulla stessa linea. Niente illustrazione, niente icona grande, niente paragrafo esplicativo.

---

## 11. Proiezione

Non è una schermata separata: è **la board a scala doppia** senza la striscia di assegnazione. Un layout in meno da mantenere, ed è la ragione per cui l'asse di larghezza di Archivo entra nel sistema.

- Sfondo `--pitch-950`.
- Cifre a `--num-xl`, larghezza 125.
- Celle a 44px invece di 22px.
- Barre del colore squadra da 3px a 8px: a tre metri sono l'unico modo per riconoscere una colonna.
- Contrasto aumentato: il testo secondario passa da `--chalk-400` a `--chalk-100`.
- Nessun elemento interattivo visibile: niente bottoni, niente campi, niente hover.

Le linee guida per i tabelloni convergono su poche cose: sans-serif, alto contrasto, spaziatura generosa perché le informazioni non si fondano a distanza, e il minor numero possibile di elementi per schermata.

---

## 12. Accessibilità

Il pavimento minimo, verificato e non dichiarato.

- **Contrasto**: 4.5:1 per il testo normale, 3:1 per cifre da 20px in su. Misurati: `--chalk-400` sta a 6.44:1 su `--pitch-900`, 5.94:1 su `--pitch-800` e 5.14:1 su `--pitch-700`, quindi passa anche nel caso peggiore delle righe alterne. `--chalk-600` sta a 3.45:1 ed è per questo riservato al disabilitato e ai segnaposto, mai a testo che vada letto.
- **Contrasto massimo evitato**: `--chalk-100` su `--pitch-900` sta intorno a 13:1 di proposito. Bianco puro su nero puro fa sanguinare il testo per chi ha astigmatismo.
- **Attenuazione, non opacità, sul testo che resta da leggere**: `--chalk-100` al 45% su `--pitch-900` scende a 3.58:1 e l'ambra a 2.85:1, sotto il pavimento. La riga «già acquistato» del §10 attenua quindi con un colore proprio, non con `opacity`, e `--unavailable` (3.09:1) resta un colore da riempimento e da icona, mai da testo.
- **Mai il colore da solo**: il colore squadra ha sempre il nome accanto e una posizione fissa nella board, l'indisponibilità ha sempre icona e testo, la violazione ha sempre un messaggio.
- **Fuoco sempre visibile**, secondo §8.
- **Tutto raggiungibile da tastiera**, non solo il flusso d'asta.
- **`prefers-reduced-motion` rispettato**.
- Target di clic minimo 32px fuori dalle tabelle. Dentro, la riga è essa stessa il target.

---

## 13. Il tema chiaro

**Non si fa.** Un'app usata una sera all'anno, di sera, in penombra, non ne ha bisogno, e sarebbe superficie da mantenere e verificare per un caso d'uso che non si presenta.

Valutata e scartata anche l'idea più interessante emersa dalla ricerca: polarità legata alla fase, chiaro per la preparazione che si fa di giorno alla scrivania, scuro per asta e proiezione. È coerente e risponde bene alla critica sul tema scuro, ma costa due temi da verificare sul contrasto e da tenere allineati. Non vale il prezzo per la v1.

Quello che va fatto comunque è la **disciplina dei token semantici**: nessun componente cita mai un primitivo. Se un giorno servirà, sarà una mappatura nuova di `--surface`, `--text` e compagnia, non un giro per centoventi componenti. Tenere la porta aperta costa zero.

Se si farà: i colori squadra vanno scuriti di circa il 15% su fondo chiaro, altrimenti perdono contrasto e si somigliano tutti.

---

## 14. Come si applica nel refactoring

L'ordine conta, perché i primi due passi cambiano tutto senza toccare quasi niente.

**Passo 1 — I token.** Primitivi, semantici, blocco `@theme` con la mappatura shadcn, e le due famiglie. A questo punto l'applicazione ha l'aspetto giusto ovunque **senza che un componente sia stato modificato**. È il passo col miglior rapporto tra risultato e rischio, e va verificato da solo.

**Passo 2 — I primitivi dell'app.** `Cifra`, `TabellaDati`, `ChipFiltro`, `BadgeRuolo`. Quattro componenti che coprono la maggior parte delle superfici.

**Passo 3 — La board.** È l'unico cambiamento strutturale, non solo di aspetto, quindi va isolato dal resto e provato con dati veri di dieci squadre a rose piene.

**Passo 4 — Vista per vista**, l'asta per prima.

**Passo 5 — La lista dei tic.** Passata finale cercando e togliendo:

- intestazioni in maiuscolo spaziato
- card attorno a tabelle
- ombre fuori da popover e dialog
- `rounded-xl` o superiore
- testo a 14px lasciato dal default di shadcn
- emoji usate come icone
- transizioni al passaggio del mouse su righe di tabella
- `outline: none` senza sostituto
- numeri scritti a mano invece che con `Cifra`
- primitivi citati direttamente nei componenti

---

## 15. Cosa non fare

Le regole che risolvono le discussioni future.

- Non usare l'ambra per niente che non sia denaro. Nemmeno per un avviso, nemmeno per un bottone primario, nemmeno una volta.
- Non usare il colore di una squadra come colore di testo.
- Non introdurre un colore semantico nuovo. Se serve un significato in più, si esprime con icona e parole.
- Non usare verde e rosso per i crediti: codificherebbero una direzione che qui non esiste.
- Non assegnare i colori squadra fuori ordine. Le prime otto sono quelle verificate.
- Non aggiungere un'animazione senza toglierne un'altra.
- Non mettere una card attorno a una tabella.
- Non aggiungere una terza famiglia tipografica.
- Non usare Archivo sotto i 20px.
- Non spiegare una sigla dove è usata. Solo dove è definita.
- Non usare l'attributo `title` nativo per spiegare una sigla, né per nient'altro.
- Non alzare la misura base sopra 13px per far respirare. La densità è una funzione.
- Non citare un primitivo dentro un componente.
