/**
 * OperationsCongeActions.tsx
 * Auteur : Adil DAIA
 *
 * Boutons + dialogues pour agir sur une demande de congé existante :
 *   - Annulation
 *   - Report (modification en place des dates)
 *   - Reprise anticipée
 * Chaque action crée une cong_operation qui part en validation N+1
 * (workflow wf_operation_conge) ; le suivi se fait via /gestion-demandes?instance=...
 *
 * Intégration : <OperationsCongeActions demande={demande} onDone={refetch} />
 *
 * ⚠️ Adapter : les imports shadcn/ui ci-dessous + (optionnel) computeDecomptes
 *    pour les jours ouvrés tenant compte des fériés.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Ban, CalendarClock, LogIn } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
export interface DemandeConge {
  id: string;
  statut: string;
  date_debut: string;          // YYYY-MM-DD
  date_fin_absence: string;    // YYYY-MM-DD
  date_retour?: string | null;
  code_type_conge: string;
  nbr_jours_decomptes?: number | null;
  nbr_jours_calendaires?: number | null;
}
type TypeOp = "annulation" | "report" | "reprise";
interface Eligibilite {
  annulation: { autorise: boolean; raison?: string };
  report: { autorise: boolean; raison?: string };
  reprise: { autorise: boolean; raison?: string };
}
interface Props {
  demande: DemandeConge;
  onDone?: () => void;
  /** Fonction jours décomptés tenant compte des fériés (optionnelle). */
  computeDecomptes?: (debut: string, fin: string) => number;
}

// ── Helpers dates ────────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00");
const addDays = (s: string, n: number) => {
  const d = parse(s); d.setDate(d.getDate() + n); return iso(d);
};
const joursCalendaires = (debut: string, fin: string) => {
  const ms = parse(fin).getTime() - parse(debut).getTime();
  return Math.max(0, Math.round(ms / 86400000) + 1);
};
const joursOuvresFallback = (debut: string, fin: string) => {
  let n = 0; const d = parse(debut); const end = parse(fin);
  while (d <= end) {
    const j = d.getDay();
    if (j !== 0 && j !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
};

// ── Composant principal ──────────────────────────────────────────────────────
export default function OperationsCongeActions({ demande, onDone, computeDecomptes }: Props) {
  const [elig, setElig] = useState<Eligibilite | null>(null);
  const [open, setOpen] = useState<TypeOp | null>(null);

  const decomptes = (a: string, b: string) =>
    computeDecomptes ? computeDecomptes(a, b) : joursOuvresFallback(a, b);

  const chargerElig = () =>
    api.get(`/cong-operations/eligibilite/${demande.id}`)
      .then(setElig)
      .catch(() => setElig(null));

  useEffect(() => { chargerElig(); /* eslint-disable-next-line */ }, [demande.id, demande.statut]);

  const refresh = () => { chargerElig(); onDone?.(); };

  const btn = (type: TypeOp, label: string, Icon: any) => {
    const e = elig?.[type];
    const disabled = !e?.autorise;
    return (
      <Button
        key={type}
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabled ? e?.raison : undefined}
        onClick={() => setOpen(type)}
      >
        <Icon className="mr-2 h-4 w-4" />
        {label}
      </Button>
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {btn("annulation", "Annuler", Ban)}
      {btn("report", "Reporter", CalendarClock)}
      {btn("reprise", "Reprise anticipée", LogIn)}

      {open === "annulation" && (
        <AnnulationDialog demande={demande} onClose={() => setOpen(null)} onDone={refresh} />
      )}
      {open === "report" && (
        <ReportDialog demande={demande} decomptes={decomptes}
          onClose={() => setOpen(null)} onDone={refresh} />
      )}
      {open === "reprise" && (
        <RepriseDialog demande={demande} decomptes={decomptes}
          onClose={() => setOpen(null)} onDone={refresh} />
      )}
    </div>
  );
}

// ── Dialogue : Annulation ─────────────────────────────────────────────────────
function AnnulationDialog({ demande, onClose, onDone }: {
  demande: DemandeConge; onClose: () => void; onDone: () => void;
}) {
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/cong-operations`, {
        demande_id: demande.id, type_operation: "annulation", motif: motif || null,
      });
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler la demande de congé</DialogTitle>
          <DialogDescription>
            L'annulation part en validation N+1. Une fois approuvée, les jours sont restitués au solde.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motif-annul">Motif (facultatif)</Label>
          <Textarea id="motif-annul" value={motif} onChange={(e) => setMotif(e.target.value)}
            placeholder="Raison de l'annulation…" />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Fermer</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Envoi…" : "Demander l'annulation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialogue : Report ─────────────────────────────────────────────────────────
function ReportDialog({ demande, decomptes, onClose, onDone }: {
  demande: DemandeConge; decomptes: (a: string, b: string) => number;
  onClose: () => void; onDone: () => void;
}) {
  const [debut, setDebut] = useState(demande.date_debut);
  const [fin, setFin] = useState(demande.date_fin_absence);
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valide = debut && fin && fin >= debut;
  const nbCal = valide ? joursCalendaires(debut, fin) : 0;
  const nbDec = valide ? decomptes(debut, fin) : 0;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/cong-operations`, {
        demande_id: demande.id, type_operation: "report", motif: motif || null,
        nouvelle_date_debut: debut, nouvelle_date_fin_absence: fin,
        nouvelle_date_retour: addDays(fin, 1),
        nouveau_nbr_jours_calendaires: nbCal, nouveau_nbr_jours_decomptes: nbDec,
      });
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reporter la demande de congé</DialogTitle>
          <DialogDescription>
            Nouvelles dates soumises à validation N+1. Les règles (durée, préavis, chevauchement, solde) sont revérifiées.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="r-debut">Nouveau début</Label>
            <Input id="r-debut" type="date" value={debut} min={iso(new Date())}
              onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-fin">Nouvelle fin d'absence</Label>
            <Input id="r-fin" type="date" value={fin} min={debut}
              onChange={(e) => setFin(e.target.value)} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {valide ? <>Durée : {nbCal} j calendaires · {nbDec} j décomptés · retour le {addDays(fin, 1)}.</>
                  : "Renseignez des dates cohérentes."}
        </p>
        <div className="space-y-2">
          <Label htmlFor="r-motif">Motif (facultatif)</Label>
          <Textarea id="r-motif" value={motif} onChange={(e) => setMotif(e.target.value)} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Fermer</Button>
          <Button onClick={submit} disabled={busy || !valide}>
            {busy ? "Envoi…" : "Demander le report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialogue : Reprise anticipée ──────────────────────────────────────────────
function RepriseDialog({ demande, decomptes, onClose, onDone }: {
  demande: DemandeConge; decomptes: (a: string, b: string) => number;
  onClose: () => void; onDone: () => void;
}) {
  const minReprise = addDays(demande.date_debut, 1);      // au moins 1 jour pris
  const maxReprise = demande.date_fin_absence;            // avant la fin prévue
  const [reprise, setReprise] = useState(minReprise);
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valide = reprise > demande.date_debut && reprise <= maxReprise;
  // Absence effective : du début jusqu'à la veille de la reprise
  const finEffective = valide ? addDays(reprise, -1) : demande.date_debut;
  const nbCal = valide ? joursCalendaires(demande.date_debut, finEffective) : 0;
  const nbDec = valide ? decomptes(demande.date_debut, finEffective) : 0;
  const restitues = (demande.nbr_jours_decomptes || 0) - nbDec;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/cong-operations`, {
        demande_id: demande.id, type_operation: "reprise", motif: motif || null,
        date_reprise_effective: reprise,
        nouveau_nbr_jours_calendaires: nbCal, nouveau_nbr_jours_decomptes: nbDec,
      });
      onDone(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reprise anticipée</DialogTitle>
          <DialogDescription>
            Le collaborateur revient avant la fin prévue. Les jours non consommés sont restitués au solde après validation N+1.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rep-date">Date de reprise effective</Label>
          <Input id="rep-date" type="date" value={reprise} min={minReprise} max={maxReprise}
            onChange={(e) => setReprise(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">
          {valide
            ? <>Absence effective jusqu'au {finEffective} · {nbDec} j décomptés · {restitues > 0 ? `${restitues} j restitués` : "aucun jour restitué"}.</>
            : "Choisissez une date entre le lendemain du début et la fin prévue."}
        </p>
        <div className="space-y-2">
          <Label htmlFor="rep-motif">Motif (facultatif)</Label>
          <Textarea id="rep-motif" value={motif} onChange={(e) => setMotif(e.target.value)} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Fermer</Button>
          <Button onClick={submit} disabled={busy || !valide}>
            {busy ? "Envoi…" : "Demander la reprise"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
