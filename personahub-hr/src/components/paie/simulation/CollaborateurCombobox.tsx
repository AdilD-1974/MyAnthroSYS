/**
 * src/components/paie/simulation/CollaborateurCombobox.tsx
 *
 * Reconstruit sur le pattern RÉEL trouvé dans TraitementPaiePage.tsx
 * (Popover + Command/CommandInput/CommandList/CommandGroup/CommandItem) —
 * plus une recherche serveur debouncée maison. Liste chargée UNE FOIS
 * (db.list sur "collaborateurs"), filtrage 100% client via le `filter` de
 * cmdk, avec fonction explicite en substring (cmdk fait du fuzzy matching
 * par défaut — point de vigilance déjà noté par ailleurs sur ce projet).
 */
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { db } from "@/lib/api";

export interface CollaborateurOption {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
}

interface CollaborateurComboboxProps {
  value: CollaborateurOption | null;
  onChange: (c: CollaborateurOption | null) => void;
  placeholder?: string;
}

export function CollaborateurCombobox({ value, onChange, placeholder = "Sélectionner…" }: CollaborateurComboboxProps) {
  const [ouvert, setOuvert] = useState(false);
  const [collaborateurs, setCollaborateurs] = useState<CollaborateurOption[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cs = await db.list<CollaborateurOption>("collaborateurs", {
          select: "id,matricule,nom,prenom",
          archive: false,
          order: "nom",
          limit: 2000,
        });
        cs.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
        setCollaborateurs(cs);
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={chargement}>
          {value ? `${value.nom} ${value.prenom} — ${value.matricule}` : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Nom, prénom ou matricule…" />
          <CommandList>
            <CommandEmpty>Aucun collaborateur.</CommandEmpty>
            <CommandGroup>
              {collaborateurs.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.nom} ${c.prenom} ${c.matricule}`}
                  onSelect={() => {
                    onChange(c);
                    setOuvert(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${c.id === value?.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1">{c.nom} {c.prenom}</span>
                  <span className="text-xs text-muted-foreground">{c.matricule}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
