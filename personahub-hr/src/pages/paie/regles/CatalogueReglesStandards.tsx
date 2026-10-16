/**
 * CatalogueReglesStandards – vue « Règles standards » de l'onglet Règles de
 * calcul. Catalogue système en lecture seule (33 opérations, non
 * modifiables), groupé par catégorie et repliable, avec recherche live.
 *
 * Aligné sur les conventions des listes voisines (ReglesSpecifiquesList,
 * ReglesCotisationList) : en-tête hsl(var(--muted)/0.5) en petites
 * capitales, teintes par catégorie via style inline hsl(var(--token)),
 * bordure rounded-xl, pas de zébrage.
 */
import { useMemo, useState } from "react";
import { Search, ChevronRight, Calendar, Hash, Wallet, ListChecks } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  GROUPES_REGLES_STANDARDS,
  type GroupeReglesStandard,
  type RegleStandard,
} from "@/data/reglesStandardsCatalogue";

const ICONES = { calendar: Calendar, hash: Hash, wallet: Wallet } as const;

// Un token de thème par catégorie — jamais de palette Tailwind figée, même
// logique que ATTRIBUT_STYLE dans ReglesSpecifiquesList.tsx.
const GROUPE_TOKEN: Record<GroupeReglesStandard["couleur"], string> = {
  accent: "--info",
  success: "--success",
  warning: "--warning",
};
const groupeStyle = (token: string): React.CSSProperties => ({
  background: `hsl(var(${token}) / 0.12)`,
  color: `hsl(var(${token}))`,
});

interface CatalogueReglesStandardsProps {
  groupes?: GroupeReglesStandard[];
}

function filtrerGroupes(groupes: GroupeReglesStandard[], terme: string): GroupeReglesStandard[] {
  if (!terme.trim()) return groupes;
  const t = terme.trim().toLowerCase();
  return groupes
    .map((g) => ({
      ...g,
      regles: g.regles.filter(
        (r) =>
          r.code.toLowerCase().includes(t) ||
          r.operation.toLowerCase().includes(t) ||
          r.description.toLowerCase().includes(t) ||
          r.formule.toLowerCase().includes(t),
      ),
    }))
    .filter((g) => g.regles.length > 0);
}

export function CatalogueReglesStandards({ groupes = GROUPES_REGLES_STANDARDS }: CatalogueReglesStandardsProps) {
  const [search, setSearch] = useState("");
  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set([groupes[0]?.id]));

  const total = useMemo(() => groupes.reduce((n, g) => n + g.regles.length, 0), [groupes]);
  const groupesAffiches = useMemo(() => filtrerGroupes(groupes, search), [groupes, search]);
  const totalAffiche = useMemo(() => groupesAffiches.reduce((n, g) => n + g.regles.length, 0), [groupesAffiches]);

  const rechercheActive = search.trim().length > 0;
  const tousOuverts = ouverts.size >= groupesAffiches.length;

  const toggleGroupe = (id: string) =>
    setOuverts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleTout = () =>
    setOuverts(tousOuverts ? new Set() : new Set(groupesAffiches.map((g) => g.id)));

  const estOuvert = (id: string) => rechercheActive || ouverts.has(id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <ListChecks size={16} className="text-muted-foreground" /> Règles standards
            <span className="text-sm font-normal text-muted-foreground">
              ({rechercheActive ? `${totalAffiche} / ${total}` : total})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Catalogue système prédéfini — opérations atomiques non modifiables, sélectionnables au paramétrage des rubriques.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={toggleTout} className="text-xs">
          {tousOuverts ? "Tout replier" : "Tout déplier"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un code, une opération, une formule…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {groupesAffiches.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Aucune règle ne correspond à « {search} ».
          </div>
        ) : (
          groupesAffiches.map((groupe, idx) => (
            <GroupeSection
              key={groupe.id}
              groupe={groupe}
              ouvert={estOuvert(groupe.id)}
              onToggle={() => toggleGroupe(groupe.id)}
              avecBordureHaut={idx > 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

function GroupeSection({
  groupe,
  ouvert,
  onToggle,
  avecBordureHaut,
}: {
  groupe: GroupeReglesStandard;
  ouvert: boolean;
  onToggle: () => void;
  avecBordureHaut: boolean;
}) {
  const Icone = ICONES[groupe.icone];
  const token = GROUPE_TOKEN[groupe.couleur];
  const style = groupeStyle(token);

  return (
    <div className={avecBordureHaut ? "border-t border-border" : ""}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
        style={style}
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform ${ouvert ? "rotate-90" : ""}`} />
        <Icone size={15} className="shrink-0" />
        <span className="text-[13px] font-semibold">{groupe.libelle}</span>
        <span className="ml-auto text-xs">
          {groupe.regles.length} règle{groupe.regles.length > 1 ? "s" : ""}
        </span>
      </button>

      {ouvert && <TableRegles regles={groupe.regles} />}
    </div>
  );
}

function TableRegles({ regles }: { regles: RegleStandard[] }) {
  return (
    <table className="w-full text-sm table-fixed">
      <colgroup>
        <col style={{ width: "22%" }} />
        <col style={{ width: "38%" }} />
        <col style={{ width: "30%" }} />
        <col style={{ width: "10%" }} />
      </colgroup>
      <thead style={{ background: "hsl(var(--muted) / 0.5)" }}>
        <tr className="text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
          <th className="px-4 py-2">Code</th>
          <th className="px-4 py-2">Opération</th>
          <th className="px-4 py-2">Formule</th>
          <th className="px-4 py-2">Unité</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {regles.map((r) => (
          <tr key={r.code} className="hover:bg-muted/40 transition-colors">
            <td className="px-4 py-2.5 align-top">
              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {r.code}
              </code>
            </td>
            <td className="px-4 py-2.5 align-top">
              <div className="font-medium text-foreground">{r.operation}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{r.description}</div>
            </td>
            <td className="px-4 py-2.5 align-top">
              <code className="text-[11px] font-mono text-muted-foreground">{r.formule}</code>
            </td>
            <td className="px-4 py-2.5 align-top">
              {r.unite ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {r.unite}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
