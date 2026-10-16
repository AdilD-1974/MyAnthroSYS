/**
 * AnomaliesPaiePage — Suivi des bulletins en erreur ou avec avertissements,
 * tous collaborateurs confondus, pour un ou plusieurs plans sur une année.
 * Route suggérée : /paie/consultation/anomalies
 *
 * Repose sur le même endpoint que RechercheBulletinsPage
 * (`GET /paie/bulletins/recherche`), avec `seulement_avec_probleme=true` —
 * pensé comme une liste de choses à traiter plutôt qu'une recherche libre :
 * pas de pagination complexe, le contenu des messages est affiché
 * directement, groupé par gravité.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, MessageCircleWarning, ChevronsUpDown, Loader2 } from "lucide-react";
import { db } from "@/lib/api";
import { rechercherBulletins, type BulletinRechercheLigne } from "@/lib/paieApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const anneeCourante = new Date().getFullYear();

type Plan = { id: string; code: string; libelle: string };

function SelecteurPlans({ plans, value, onChange }: { plans: Plan[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toutCoche = value.length === plans.length && plans.length > 0;
  const resume = toutCoche ? "Tous les plans" : value.length === 1 ? plans.find((p) => p.id === value[0])?.code ?? "1 plan" : `${value.length} plans`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-[220px] justify-between font-normal">
          <span>{resume}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => onChange(toutCoche ? [] : plans.map((p) => p.id))}>
                <Checkbox checked={toutCoche} className="mr-2 pointer-events-none" />Tous les plans
              </CommandItem>
              {plans.map((p) => (
                <CommandItem key={p.id} value={p.code + " " + p.libelle} onSelect={() => toggle(p.id)}>
                  <Checkbox checked={value.includes(p.id)} className="mr-2 pointer-events-none" />{p.code} · {p.libelle}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LigneAnomalie({ l }: { l: BulletinRechercheLigne }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/20">
      <div className={`mt-0.5 rounded-full p-1.5 shrink-0 ${l.a_erreur ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
        {l.a_erreur ? <ShieldAlert className="h-3.5 w-3.5" /> : <MessageCircleWarning className="h-3.5 w-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium">{l.nom} {l.prenom}</span>
          <span className="text-xs text-muted-foreground font-mono">{l.matricule}</span>
          <span className="text-xs text-muted-foreground">· {l.plan_code} · {l.intitule || `${MOIS[l.mois]} ${l.periode_annee}`}</span>
        </div>
        {l.messages && l.messages.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {l.messages.map((m, i) => (
              <li key={i} className="text-xs text-muted-foreground">— {m}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground italic">Bulletin en erreur, sans message détaillé.</p>
        )}
      </div>
      <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">{fmt(l.net_a_payer)} DH</span>
    </div>
  );
}

export default function AnomaliesPaiePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [annee, setAnnee] = useState(anneeCourante);
  const [officiel, setOfficiel] = useState(false);
  const [lignes, setLignes] = useState<BulletinRechercheLigne[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 })
      .then((rows) => { setPlans(rows); setPlanIds((a) => (a.length ? a : rows.map((p) => p.id))); })
      .catch((e) => toast.error("Chargement des plans impossible", { description: e.message }));
  }, []);

  useEffect(() => {
    if (!planIds.length) { setLignes([]); setTotal(0); return; }
    setChargement(true);
    rechercherBulletins(planIds, annee, { seulementAvecProbleme: true, officiel, limit: 500 })
      .then((r) => { setLignes(r.lignes); setTotal(r.total); })
      .catch((e) => toast.error("Chargement des anomalies impossible", { description: e.message }))
      .finally(() => setChargement(false));
  }, [planIds, annee, officiel]);

  const enErreur = useMemo(() => lignes.filter((l) => l.a_erreur), [lignes]);
  const avecAvertissement = useMemo(() => lignes.filter((l) => !l.a_erreur && l.nb_messages > 0), [lignes]);

  return (
    <div className="p-6 space-y-4 max-w-[1100px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><AlertTriangle className="h-6 w-6 text-rose-800" /> Anomalies de paie</h1>
        <p className="text-sm text-muted-foreground mt-1">Bulletins en erreur ou avec avertissements, tous collaborateurs confondus.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SelecteurPlans plans={plans} value={planIds} onChange={setPlanIds} />
        <Select value={String(annee)} onValueChange={(v) => setAnnee(Number(v))}>
          <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 6 }, (_, i) => anneeCourante - i).map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          {([[false, "Précalculs inclus"], [true, "Validés/clôturés uniquement"]] as const).map(([v, lbl]) => (
            <button key={String(v)} onClick={() => setOfficiel(v)}
              className={`px-3 py-1.5 transition-colors ${officiel === v ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="rounded-lg bg-rose-50 p-2 text-rose-700"><ShieldAlert className="h-4 w-4" /></div>
            <div>
              <div className="text-xs text-muted-foreground">En erreur</div>
              <div className="text-lg font-semibold tabular-nums">{enErreur.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><MessageCircleWarning className="h-4 w-4" /></div>
            <div>
              <div className="text-xs text-muted-foreground">Avec avertissement</div>
              <div className="text-lg font-semibold tabular-nums">{avecAvertissement.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {chargement && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
      )}

      {!chargement && lignes.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Aucune anomalie détectée pour cette sélection. 🎉</CardContent></Card>
      )}

      {!chargement && enErreur.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 bg-rose-50/60 text-xs font-semibold uppercase tracking-wide text-rose-800 border-b">
            En erreur ({enErreur.length})
          </div>
          <CardContent className="p-0">
            {enErreur.map((l) => <LigneAnomalie key={l.id} l={l} />)}
          </CardContent>
        </Card>
      )}

      {!chargement && avecAvertissement.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 bg-amber-50/60 text-xs font-semibold uppercase tracking-wide text-amber-800 border-b">
            Avec avertissement ({avecAvertissement.length})
          </div>
          <CardContent className="p-0">
            {avecAvertissement.map((l) => <LigneAnomalie key={l.id} l={l} />)}
          </CardContent>
        </Card>
      )}

      {total > lignes.length && (
        <p className="text-xs text-center text-muted-foreground">
          {total - lignes.length} anomalie(s) supplémentaire(s) non affichée(s) — affinez les filtres (plan/année) pour tout voir.
        </p>
      )}
    </div>
  );
}
