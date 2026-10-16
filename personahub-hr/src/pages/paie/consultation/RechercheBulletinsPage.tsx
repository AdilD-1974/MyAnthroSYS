/**
 * RechercheBulletinsPage — Recherche transverse de bulletins, tous
 * collaborateurs confondus, pour un ou plusieurs plans sur une année.
 * Route suggérée : /paie/consultation/recherche-bulletins
 *
 * Complète HistoriqueCollaborateurPage (carnet d'UN collaborateur) avec une
 * vue de type "recherche / audit" côté gestionnaire : texte libre, filtres
 * multiples, export.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Download, ChevronsUpDown, AlertTriangle, FileBadge2, ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/api";
import { rechercherBulletins, type BulletinRechercheLigne, type OrigineBulletin } from "@/lib/paieApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import * as XLSX from "xlsx";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const anneeCourante = new Date().getFullYear();

type Plan = { id: string; code: string; libelle: string };
type Uo = { id: string; libelle: string };
type Contrat = { code: string; libelle: string };

const STATUT_STYLE: Record<string, string> = {
  CALCULE: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  VALIDE: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  CLOTURE: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
};
const ORIGINE_STYLE: Record<OrigineBulletin, string> = {
  TEMP: "border-amber-600 text-amber-700",
  VALIDE: "border-emerald-700 text-emerald-700",
  HISTORIQUE: "border-slate-500 text-slate-600",
};
const ORIGINE_LABEL: Record<OrigineBulletin, string> = { TEMP: "Précalcul", VALIDE: "Validé", HISTORIQUE: "Archivé" };

// ---- Sélecteur multi-choix générique (repris du même patron que les autres écrans) --
function SelecteurMulti({ items, value, onChange, labelTout, largeur = 200 }: {
  items: { id: string; libelle: string }[]; value: string[]; onChange: (v: string[]) => void;
  labelTout: string; largeur?: number;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toutCoche = value.length === 0;
  const resume = toutCoche ? labelTout : value.length === 1 ? items.find((p) => p.id === value[0])?.libelle ?? "1 sélectionné" : `${value.length} sélectionnés`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" style={{ width: largeur }} className="justify-between font-normal">
          <span className={toutCoche ? "text-muted-foreground truncate" : "truncate"}>{resume}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent style={{ width: largeur }} className="p-0" align="start">
        <Command>
          <CommandList className="max-h-64">
            <CommandGroup>
              <CommandItem onSelect={() => onChange([])}>
                <Checkbox checked={toutCoche} className="mr-2 pointer-events-none" />{labelTout}
              </CommandItem>
              {items.map((it) => (
                <CommandItem key={it.id} value={it.libelle} onSelect={() => toggle(it.id)}>
                  <Checkbox checked={value.includes(it.id)} className="mr-2 pointer-events-none" />{it.libelle}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---- Anomalie cliquable : liste les messages au lieu d'un simple survol --
function AnomaliePopover({ l }: { l: BulletinRechercheLigne }) {
  const [open, setOpen] = useState(false);
  if (!l.a_erreur && l.nb_messages === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 text-xs rounded px-1 -mx-1 hover:bg-muted/60 transition-colors ${l.a_erreur ? "text-rose-700" : "text-amber-700"}`}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> {l.a_erreur ? "Erreur" : l.nb_messages}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b ${l.a_erreur ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>
          {l.a_erreur ? "Bulletin en erreur" : `${l.nb_messages} avertissement(s)`}
        </div>
        <div className="max-h-64 overflow-y-auto p-3 space-y-1.5">
          {l.messages && l.messages.length > 0 ? (
            l.messages.map((m, i) => <p key={i} className="text-xs text-foreground/90">— {m}</p>)
          ) : (
            <p className="text-xs text-muted-foreground italic">Aucun message détaillé pour ce bulletin.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function RechercheBulletinsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [uos, setUos] = useState<Uo[]>([]);
  const [uoIds, setUoIds] = useState<string[]>([]);
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [contratCodes, setContratCodes] = useState<string[]>([]);
  const [annee, setAnnee] = useState(anneeCourante);
  const [q, setQ] = useState("");
  const [statuts, setStatuts] = useState<string[]>([]);
  const [origines, setOrigines] = useState<OrigineBulletin[]>([]);
  const [officiel, setOfficiel] = useState(false);

  const [lignes, setLignes] = useState<BulletinRechercheLigne[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [chargement, setChargement] = useState(false);
  const LIMITE = 50;

  useEffect(() => {
    Promise.allSettled([
      db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 }),
      db.list<Uo>("unites_organisationnelles", { select: "id,libelle", actif: true, order: "libelle", limit: 500 }),
      db.list<Contrat>("ref_type_contrat", { select: "code,libelle", order: "libelle", limit: 200 }),
    ]).then(([rp, ru, rc]) => {
      if (rp.status === "fulfilled") { setPlans(rp.value); if (rp.value.length) setPlanIds((a) => (a.length ? a : rp.value.map((p) => p.id))); }
      if (ru.status === "fulfilled") setUos(ru.value);
      if (rc.status === "fulfilled") setContrats(rc.value);
    });
  }, []);

  // Redémarre à la page 0 dès qu'un filtre change (hors pagination elle-même)
  useEffect(() => { setPage(0); }, [planIds, uoIds, contratCodes, annee, q, statuts, origines, officiel]);

  useEffect(() => {
    if (!planIds.length) { setLignes([]); setTotal(0); return; }
    setChargement(true);
    const t = setTimeout(() => {
      rechercherBulletins(planIds, annee, {
        q, statut: statuts, origine: origines, officiel,
        organisationIds: uoIds, typesContrat: contratCodes,
        limit: LIMITE, offset: page * LIMITE,
      })
        .then((r) => { setLignes(r.lignes); setTotal(r.total); })
        .catch((e) => toast.error("Recherche impossible", { description: e.message }))
        .finally(() => setChargement(false));
    }, q ? 350 : 0); // léger anti-rebond uniquement sur la saisie texte
    return () => clearTimeout(t);
  }, [planIds, annee, q, statuts, origines, officiel, uoIds, contratCodes, page]);

  const nbPages = Math.max(1, Math.ceil(total / LIMITE));

  const exporter = () => {
    const data = lignes.map((l) => ({
      Matricule: l.matricule, Nom: l.nom, Prénom: l.prenom, Plan: l.plan_code,
      Période: l.intitule || `${MOIS[l.mois]} ${l.periode_annee}`,
      Statut: l.statut, Origine: ORIGINE_LABEL[l.origine],
      "Net à payer": l.net_a_payer, "Coût employeur": l.cout_employeur,
      Anomalie: l.a_erreur ? "Erreur" : l.nb_messages > 0 ? "Avertissement" : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Bulletins");
    XLSX.writeFile(wb, `recherche_bulletins_${annee}.xlsx`);
  };

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Search className="h-6 w-6 text-rose-800" /> Recherche de bulletins</h1>
        <p className="text-sm text-muted-foreground mt-1">Tous collaborateurs confondus — filtrez par plan, organisation, statut ou texte libre.</p>
      </div>

      <Card>
        <CardContent className="pt-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <label className="text-xs text-muted-foreground">Matricule, nom, prénom</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-8" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Plans</label>
            <SelecteurMulti items={plans.map((p) => ({ id: p.id, libelle: `${p.code} · ${p.libelle}` }))} value={planIds} onChange={setPlanIds} labelTout="Tous les plans" largeur={200} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Organisation</label>
            <SelecteurMulti items={uos} value={uoIds} onChange={setUoIds} labelTout="Toutes organisations" largeur={190} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Contrat</label>
            <SelecteurMulti items={contrats.map((c) => ({ id: c.code, libelle: c.libelle }))} value={contratCodes} onChange={setContratCodes} labelTout="Tous contrats" largeur={170} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Statut</label>
            <SelecteurMulti items={[{ id: "CALCULE", libelle: "Calculé" }, { id: "VALIDE", libelle: "Validé" }, { id: "CLOTURE", libelle: "Clôturé" }]} value={statuts} onChange={(v) => setStatuts(v as string[])} labelTout="Tous statuts" largeur={150} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Origine</label>
            <SelecteurMulti
              items={[{ id: "TEMP", libelle: "Précalcul" }, { id: "VALIDE", libelle: "Validé" }, { id: "HISTORIQUE", libelle: "Archivé" }]}
              value={origines} onChange={(v) => setOrigines(v as OrigineBulletin[])} labelTout="Toutes origines" largeur={150}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Année</label>
            <Select value={String(annee)} onValueChange={(v) => setAnnee(Number(v))}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 6 }, (_, i) => anneeCourante - i).map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={exporter} disabled={!lignes.length} className="gap-1.5">
            <Download size={14} /> Exporter
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table className="text-sm [&_td]:py-2 [&_th]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead className="text-right">Net à payer</TableHead>
                <TableHead className="text-right">Coût employeur</TableHead>
                <TableHead>Anomalie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((l) => (
                <TableRow key={l.id} className={l.a_erreur ? "bg-rose-50/40" : undefined}>
                  <TableCell>
                    <div className="font-medium">{l.nom} {l.prenom}</div>
                    <div className="text-xs text-muted-foreground font-mono">{l.matricule}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.plan_code}</TableCell>
                  <TableCell className="text-xs">{l.intitule || `${MOIS[l.mois]} ${l.periode_annee}`}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUT_STYLE[l.statut] ?? "bg-slate-50 text-slate-600 ring-1 ring-slate-200"}`}>{l.statut}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${ORIGINE_STYLE[l.origine]}`}>{ORIGINE_LABEL[l.origine]}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmt(l.net_a_payer)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(l.cout_employeur)}</TableCell>
                  <TableCell>
                    <AnomaliePopover l={l} />
                  </TableCell>
                </TableRow>
              ))}
              {!chargement && lignes.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Aucun bulletin ne correspond à ces critères.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} bulletin(s) · page {page + 1}/{nbPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= nbPages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
