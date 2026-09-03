/**
 * Primitive shadcn, generata dalla CLI, **superata da `components/DataTable.tsx`
 * e ancora senza nessun import.**
 *
 * La tabella dei Giocatori di T9 non la usa apposta: è virtualizzata, e ha
 * bisogno di controllare `tbody`, le righe distanziatrici e il contenitore che
 * scorre — cose che il wrapper `overflow-x-auto` di questo componente le toglie.
 * Il commento che stava qui diceva di tenerla perché «le tabelle non
 * virtualizzate arrivano subito dopo»: sono arrivate — lo storico del dettaglio,
 * la cronologia d'asta, la revisione — e nessuna la usa. T23 ha scritto le parti
 * del §10 del documento 7, che sono **parti** proprio per la ragione qui sopra.
 * Curiosamente questo file era anche il solo posto del progetto dove i 40px di
 * riga del §5 erano già scritti (`h-10` sul `TableHead`, più sotto).
 *
 * Resta perché la CLI di shadcn può richiederla come dipendenza di un componente
 * futuro, e perché cancellare codice morto è la passata finale del §14, cioè
 * T25. Non aggiungerne usi: la tabella dell'app è `DataTable`.
 *
 * `lib/utils.ts` (`cn`) esiste per lo stesso motivo: ogni componente generato lo
 * importa.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
