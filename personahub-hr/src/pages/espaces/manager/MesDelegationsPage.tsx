/**
 * MesDelegationsPage.tsx
 * Auteur : Adil DAIA
 *
 * Gestion des délégations PERMANENTES de validation (wf_delegation) :
 * « du .. au .., je délègue mes validations à X ». Le délégataire REMPLACE
 * le délégant dans les inbox pendant la période.
 *  - Chaque utilisateur gère ses propres délégations.
 *  - Un RH / administrateur peut en créer pour le compte d'autrui.
 *
 * Route : /mes-delegations
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, UserCheck } from "lucide-react";
import CollaborateurPicker from "@/components/CollaborateurPicker";

interface Workflow { code: string; libelle: string; }
interface Delegation {
  id: string; delegant_id: string; delegue_id: string;
  date_debut: string; date_fin: string | null;
  scope_workflow_code: string | null; motif: string | null; actif: boolean;
  delegant_nom?: string; delegant_prenom?: string;
  delegue_nom?: string; delegue_prenom?: string;
}

const ALL = "__all__";

export default function MesDelegationsPage() {
  const { role } = useAuth() as any;
  const estAdmin = role === "administrateur" || role === "gestionnaire_rh";

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [delegueId, setDelegueId] = useState("");
  const [delegantId, setDelegantId] = useState("");      // RH/admin : pour autrui
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [scopeWf, setScopeWf] = useState(ALL);
  const [motif, setMotif] = useState("");

  const charger = () =>
    api.get(`/workflow/delegations`).then((d) => setDelegations(d || [])).catch((e) => setErr(human(e)));

  useEffect(() => {
    api.get(`/db/ref_workflow?statut=eq.ACTIF&select=code,libelle&order=libelle`)
      .then((r) => setWorkflows(r || [])).catch(() => {});
    charger();
  }, []);

  const creer = async () => {
    setErr(null);
    if (!delegueId) { setErr("Choisissez un délégataire."); return; }
    setBusy(true);
    try {
      await api.post(`/workflow/delegations`, {
        delegue_id: delegueId,
        delegant_id: estAdmin && delegantId ? delegantId : undefined,
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
        scope_workflow_code: scopeWf === ALL ? undefined : scopeWf,
        motif: motif || undefined,
      });
      setDelegueId(""); setDelegantId(""); setDateDebut(""); setDateFin("");
      setScopeWf(ALL); setMotif("");
      charger();
    } catch (e) { setErr(human(e)); } finally { setBusy(false); }
  };

  const revoquer = async (id: string) => {
    try { await api.delete(`/workflow/delegations/${id}`); charger(); }
    catch (e) { setErr(human(e)); }
  };

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");
  const today = new Date().toISOString().slice(0, 10);
  const etat = (d: Delegation) => {
    if (!d.actif) return { label: "Révoquée", variant: "outline" as const };
    if (d.date_fin && d.date_fin < today) return { label: "Expirée", variant: "outline" as const };
    if (d.date_debut > today) return { label: "À venir", variant: "secondary" as const };
    return { label: "Active", variant: "default" as const };
  };

  const wfLabel = useMemo(() => {
    const m = new Map(workflows.map((w) => [w.code, w.libelle]));
    return (code: string | null) => (code ? m.get(code) || code : "Tous les workflows");
  }, [workflows]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Délégations de validation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pendant la période choisie, vos tâches de validation sont transférées au délégataire.
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: "hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2"><UserCheck size={15} /> Nouvelle délégation</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {estAdmin && (
            <div className="space-y-1.5">
              <Label>Délégant (vide = moi)</Label>
              <CollaborateurPicker value={delegantId} onChange={setDelegantId} placeholder="Moi-même" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Délégataire *</Label>
            <CollaborateurPicker value={delegueId} onChange={setDelegueId} excludeId={delegantId || undefined} />
          </div>

          <div className="space-y-1.5">
            <Label>Du</Label>
            <Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Au (vide = sans fin)</Label>
            <Input type="date" value={dateFin} min={dateDebut} onChange={(e) => setDateFin(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Périmètre</Label>
            <Select value={scopeWf} onValueChange={setScopeWf}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les workflows</SelectItem>
                {workflows.map((w) => <SelectItem key={w.code} value={w.code}>{w.libelle}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Motif (facultatif)</Label>
            <Input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Congés, mission…" />
          </div>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button onClick={creer} disabled={busy || !delegueId}>
          {busy ? "Enregistrement…" : "Créer la délégation"}
        </Button>
      </div>

      <div className="rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="px-4 py-2 border-b text-sm font-medium" style={{ borderColor: "hsl(var(--border))" }}>
          Délégations ({delegations.length})
        </div>
        {delegations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Aucune délégation.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
            {delegations.map((d) => {
              const e = etat(d);
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-medium">
                        {d.delegant_prenom} {d.delegant_nom} → {d.delegue_prenom} {d.delegue_nom}
                      </span>
                      <Badge variant={e.variant}>{e.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmt(d.date_debut)} → {fmt(d.date_fin)} · {wfLabel(d.scope_workflow_code)}
                      {d.motif ? ` · ${d.motif}` : ""}
                    </p>
                  </div>
                  {d.actif && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Révoquer"
                      onClick={() => revoquer(d.id)}>
                      <Trash2 size={15} className="text-red-600" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function human(e: any): string {
  return typeof e === "string" ? e
    : e?.response?.data?.detail || e?.data?.detail || e?.detail || e?.message
    || "Erreur (vérifier que le backend est démarré).";
}
