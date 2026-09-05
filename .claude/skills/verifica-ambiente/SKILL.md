---
name: verifica-ambiente
description: Esegue i controlli che le note d'ambiente dichiarano e dice quali sono invecchiate. Usare all'inizio di un task che tocca build, pacchetti o rilascio, o quando una nota su cosa si può costruire da questa macchina sembra sospetta.
version: 0.1.0
---

# Verifica le note d'ambiente

Il `CLAUDE.md` dice che **una nota d'ambiente scade il giorno che installi il
pacchetto che dichiarava mancante**, e scade nella direzione comoda: continui a
evitare una cosa che ormai funziona, e non fallisce niente.

In due giorni ne sono marcite tre.

| nota | quanto è rimasta falsa | come si è scoperta |
|---|---|---|
| «il `.deb` non si costruisce, serve `libxcrypt-compat`» | settimane | un `rpm -q` fatto per altro |
| «Windows non si costruisce, NSIS vuole wine» | un giorno | l'utente l'ha detto |
| «su questa macchina manca FUSE2» | un giorno | l'utente l'ha installato |

Nessuna delle tre l'ha trovata un tentativo: le note che dicono «non si può»
sono proprio quelle che nessuno riprova. Da lì la regola del `CLAUDE.md` — una
nota d'ambiente dice **come si verifica** — e questa skill è quella regola resa
eseguibile.

## Uso

```bash
bash .claude/skills/verifica-ambiente/controlla.sh
```

Non modifica niente: legge e basta.

## Cosa distingue

**Fatti**: quello che una nota *afferma* sulla macchina — wine c'è, il modulo
nativo è un ELF. Se non combacia, la nota è invecchiata e va riscritta **dove
sta**, che può essere `CLAUDE.md`, `.claude.local.md` o una skill.

**Condizioni**: uno stato di cui una nota *avverte* — `ELECTRON_RUN_AS_NODE`
esportata nel terminale. Se è presente, la nota ha ragione **adesso**: va
obbedita, non corretta.

Confonderle è stato il primo difetto di questo script, ed è la stessa distinzione
che serve leggendo il `CLAUDE.md`: «il `.deb` vuole `libxcrypt-compat`» e
«VS Code esporta `ELECTRON_RUN_AS_NODE`» si leggono uguali e invecchiano in modi
opposti.

## Quando serve davvero

- **All'inizio di un task che tocca build, pacchetti o rilascio.** Le righe su
  cosa si costruisce da questa macchina sono quelle che cambiano di più.
- **Dopo un `npm ci` o una build incrociata**, che sono i due modi noti di
  lasciare `better-sqlite3` per la piattaforma sbagliata.
- **Cambiando macchina.** Il progetto vive su Fedora e su macOS: i controlli
  `rpm -q` lì non diranno niente di utile, e va bene — quello che conta è quali
  strumenti ci sono.

## Aggiungere un controllo

Una nota d'ambiente nuova è una riga in più in `controlla.sh`: cosa afferma, il
comando che lo verifica, e cosa ne segue se la risposta cambia. Se una nota non
si sa verificare con un comando, è scritta male: il `CLAUDE.md` chiede il
contrario.

E provala nei due versi, come ogni guardia di questa repo — una che non scatta
mai è indistinguibile da una macchina sempre a posto. Si nasconde uno strumento
con un `PATH` finto e si guarda che la riga diventi `CAMBIATO`.
