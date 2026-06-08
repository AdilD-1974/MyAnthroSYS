/**
 * BoutonClotureContrats — Bouton admin pour déclencher la clôture des contrats échus.
 *
 * Comportement :
 *  1. Au montage, appelle /preview pour savoir combien de contrats sont à clôturer
 *  2. Si count > 0 → affiche un bouton "Clôturer N contrats échus"
 *  3. Si count = 0 → affiche un message vert "Aucun contrat à clôturer"
 *  4. Clic → confirm() puis appel POST → toast + rafraîchissement
 *
 * À placer où tu veux : page Paramètres RH, dashboard admin, etc.
 *   import BoutonClotureContrats from "@/components/admin/BoutonClotureContrats";
 *   <BoutonClotureContrats />
 *
 * Note : la clôture automatique tourne déjà à 01:00 chaque jour côté serveur.
 * Ce bouton n'est utile que pour forcer manuellement (en attendant le cron du
 * lendemain, ou pour traiter en cours de journée des contrats arrivés à échéance
 * dans la nuit qui suit le précédent run).
 */
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PreviewResponse {
  date_reference: string;
  count: number;
  contrats: Array<{
    id: string;
    matricule: string | null;
    nom: string | null;
    prenom: string | null;
    code_type_contrat: string;
    date_fin: string;
  }>;
}

interface ExecResponse {
  date_execution: string;
  contrats_clotures: number;
}

const BoutonClotureContrats: React.FC = () => {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PreviewResponse>("/admin/contrats/cloturer-echus/preview");
      setPreview(data);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
  }, []);

  const runCloture = async () => {
    if (!preview || preview.count === 0) return;
    if (!confirm(`Clôturer ${preview.count} contrat(s) arrivé(s) à échéance ?`)) return;

    setRunning(true);
    try {
      const data = await api.post<ExecResponse>("/admin/contrats/cloturer-echus", {});
      toast.success(`${data.contrats_clotures} contrat(s) basculé(s) en ÉCHU`);
      loadPreview();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur de clôture");
    } finally {
      setRunning(false);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-lg border text-sm"
        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
      >
        <Loader2 size={14} className="animate-spin" />
        Vérification des contrats à clôturer…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-start gap-2 px-4 py-3 rounded-lg border text-sm"
        style={{
          borderColor: "hsl(0 84% 55% / 0.3)",
          background: "hsl(0 84% 55% / 0.08)",
          color: "hsl(0 84% 35%)",
        }}
      >
        <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <p className="font-medium">Impossible de vérifier les contrats à clôturer</p>
          <p className="text-xs mt-0.5 opacity-80">{error}</p>
        </div>
      </div>
    );
  }

  if (!preview || preview.count === 0) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-lg border text-sm"
        style={{
          borderColor: "hsl(142 70% 45% / 0.3)",
          background: "hsl(142 70% 45% / 0.08)",
          color: "hsl(142 70% 30%)",
        }}
      >
        <CheckCircle2 size={14} />
        <span>Aucun contrat à clôturer aujourd'hui.</span>
        <span className="text-xs opacity-70 ml-auto">
          Auto-clôture programmée chaque jour à 01:00
        </span>
      </div>
    );
  }

  return (
    <div
      className="px-4 py-3 rounded-lg border"
      style={{
        borderColor: "hsl(45 100% 50% / 0.3)",
        background: "hsl(45 100% 50% / 0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p
            className="text-sm font-semibold flex items-center gap-2"
            style={{ color: "hsl(45 100% 25%)" }}
          >
            <AlertCircle size={14} />
            {preview.count} contrat{preview.count > 1 ? "s" : ""} arrivé
            {preview.count > 1 ? "s" : ""} à échéance
          </p>
          <p className="text-xs mt-1" style={{ color: "hsl(45 100% 30%)" }}>
            Ces contrats seront basculés en statut ÉCHU automatiquement à 01:00.
            Tu peux les clôturer dès maintenant si nécessaire.
          </p>

          {/* Aperçu des 5 premiers */}
          <ul
            className="mt-2 text-[11px] space-y-0.5"
            style={{ color: "hsl(45 100% 30%)" }}
          >
            {preview.contrats.slice(0, 5).map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className="font-medium">{c.matricule ?? "—"}</span>
                <span>{c.nom} {c.prenom}</span>
                <span className="opacity-70">·</span>
                <span>{c.code_type_contrat}</span>
                <span className="opacity-70">·</span>
                <span>fin {new Date(c.date_fin).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
            {preview.contrats.length > 5 && (
              <li className="opacity-70">
                … et {preview.contrats.length - 5} autre{preview.contrats.length - 5 > 1 ? "s" : ""}
              </li>
            )}
          </ul>
        </div>

        <Button
          size="sm"
          onClick={runCloture}
          disabled={running}
          style={{ background: "hsl(45 100% 40%)", color: "white" }}
        >
          {running ? (
            <>
              <Loader2 size={13} className="animate-spin mr-1" />
              Clôture…
            </>
          ) : (
            <>Clôturer maintenant</>
          )}
        </Button>
      </div>
    </div>
  );
};

export default BoutonClotureContrats;
