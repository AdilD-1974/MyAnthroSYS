/**
 * ExportComptaPage – Export multi-formats des écritures d'un lot déjà généré
 * (MODULE_COMPTA_PAIE.md §4).
 *
 * Route : /paie/compta/export (admin, gestionnaire_paie).
 *
 * - Sélection du lot (statut GENERE / EXPORTE / COMPTABILISE).
 * - Choix du format parmi le référentiel `ref_format_export_compta` (§4.2).
 * - Téléchargement du fichier ; le lot peut être réexporté à l'identique tant
 *   qu'il n'a pas été régénéré (§4.3).
 * - Historique des exports du lot (date, format, utilisateur).
 *
 * Peut recevoir `location.state.lotId` en arrivant depuis l'écran de
 * génération (bouton « Aller à l'export ») pour présélectionner le lot.
 *
 * ⚠️ Branché sur comptaApi.ts (04/08) — remplace comptaPaieApi.ts, écrit sur
 * la spec et incompatible avec le backend réel sur plusieurs points (mauvaise
 * table d'historique, colonnes plan_paie_code/annee/periode inexistantes sur
 * lot_ecriture_paie, format de payload d'export erroné). comptaApi.ts est la
 * version alignée sur compta_paie.py, déjà utilisée par GenerationEcrituresPage.tsx.
 * comptaApi.listerLots() fait la jointure plan/période côté JS (le proxy /db
 * ne fait pas de jointures imbriquées).
 *
 * Style harmonisé avec GenerationEcrituresPage.tsx / VueComptabilitePage.tsx :
 * composants shadcn/ui + couleurs exclusivement via variables CSS de thème.
 */
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, History, CheckCircle2, Loader2 } from "lucide-react";
import {
  comptaApi,
  declencherTelechargement,
  type LotAvecLibelles,
  type FormatExport,
  type ExportHistorique,
} from "@/lib/comptaApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  onBack?: () => void;
}

function statutTone(statut: string) {
  switch (statut) {
    case "GENERE": return "--warning";
    case "EXPORTE": return "--info";
    case "COMPTABILISE": return "--success";
    default: return "--muted-foreground";
  }
}

function statutLabel(statut: string) {
  switch (statut) {
    case "BROUILLON": return "Brouillon";
    case "GENERE": return "Généré";
    case "EXPORTE": return "Exporté";
    case "COMPTABILISE": return "Comptabilisé";
    default: return statut;
  }
}

function StatutBadge({ statut }: { statut: string }) {
  const tone = statutTone(statut);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: `hsl(var(${tone}) / 0.1)`, color: `hsl(var(${tone}))`, boxShadow: `inset 0 0 0 1px hsl(var(${tone}) / 0.25)` }}
    >
      {statutLabel(statut)}
    </span>
  );
}

const ExportComptaPage: React.FC<Props> = ({ onBack }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const preselectLotId = (location.state as { lotId?: string } | null)?.lotId;

  const [lots, setLots] = useState<LotAvecLibelles[]>([]);
  const [formats, setFormats] = useState<FormatExport[]>([]);
  const [selectedAnnee, setSelectedAnnee] = useState<string>("");
  const [selectedPeriode, setSelectedPeriode] = useState<string>("");
  const [selectedLotId, setSelectedLotId] = useState(preselectLotId || "");
  const [selectedFormat, setSelectedFormat] = useState("");
  const [historique, setHistorique] = useState<ExportHistorique[]>([]);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [lotsData, formatsData] = await Promise.all([comptaApi.listerLots(), comptaApi.listerFormats()]);
        // Seuls les lots déjà générés (ou au-delà) peuvent être exportés.
        const lotsExportables = lotsData.filter((l) => l.statut !== "BROUILLON");
        setLots(lotsExportables);
        setFormats(formatsData);
        if (formatsData.length > 0) setSelectedFormat(formatsData[0].code);
        // Pré-remplissage Année/Période à partir du lot présélectionné
        // (arrivée depuis « Aller à l'export » sur l'écran de génération).
        if (preselectLotId) {
          const lotPreselectionne = lotsExportables.find((l) => l.id === preselectLotId);
          if (lotPreselectionne) {
            if (lotPreselectionne.annee != null) setSelectedAnnee(String(lotPreselectionne.annee));
            if (lotPreselectionne.numero_periode != null) setSelectedPeriode(String(lotPreselectionne.numero_periode));
          }
        }
      } catch (e: any) {
        setError(e.message || "Erreur de chargement.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedLotId) {
      setHistorique([]);
      return;
    }
    comptaApi.listerHistoriqueExports(selectedLotId)
      .then(setHistorique)
      .catch(() => setHistorique([]));
  }, [selectedLotId]);

  const selectedLot = lots.find((l) => l.id === selectedLotId) || null;

  // Cascade Année -> Période -> Lot, pour ne pas avoir à chercher le lot
  // dans une longue liste plate.
  const anneesDisponibles = Array.from(new Set(lots.filter((l) => l.annee != null).map((l) => l.annee as number)))
    .sort((a, b) => b - a);

  const periodesDisponibles = Array.from(
    new Map(
      lots
        .filter((l) => l.annee != null && String(l.annee) === selectedAnnee && l.numero_periode != null)
        .map((l) => [l.numero_periode as number, l.periode_intitule])
    ).entries()
  ).sort((a, b) => a[0] - b[0]);

  const lotsFiltres = lots.filter(
    (l) => (!selectedAnnee || String(l.annee) === selectedAnnee) &&
           (!selectedPeriode || String(l.numero_periode) === selectedPeriode)
  );

  const handleAnneeChange = (v: string) => {
    setSelectedAnnee(v);
    setSelectedPeriode("");
    setSelectedLotId("");
  };
  const handlePeriodeChange = (v: string) => {
    setSelectedPeriode(v);
    setSelectedLotId("");
  };

  const handleTelecharger = async () => {
    if (!selectedLotId || !selectedFormat) return;
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const { blob, filename } = await comptaApi.exporterLot(selectedLotId, selectedFormat);
      declencherTelechargement(blob, filename);
      setSuccess(`Fichier « ${filename} » téléchargé.`);
      const hist = await comptaApi.listerHistoriqueExports(selectedLotId).catch(() => []);
      setHistorique(hist);
      // Le lot passe à EXPORTE côté backend : on met à jour l'affichage local
      // sans tout recharger.
      setLots((prev) => prev.map((l) => (l.id === selectedLotId ? { ...l, statut: "EXPORTE" } : l)));
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'export.");
    } finally {
      setExporting(false);
    }
  };

  // Option A (05/08) : tampon date/auteur de comptabilisation sur le lot,
  // pas de statut par écriture. Réservé aux lots EXPORTE (le backend refuse
  // aussi, 409, pour tout autre statut — double protection).
  const [comptabilisationEnCours, setComptabilisationEnCours] = useState(false);
  const handleComptabiliser = async () => {
    if (!selectedLotId || selectedLot?.statut !== "EXPORTE") return;
    setComptabilisationEnCours(true);
    setError(null);
    try {
      const lotMaj = await comptaApi.comptabiliserLot(selectedLotId);
      setLots((prev) => prev.map((l) => (l.id === selectedLotId ? { ...l, ...lotMaj } : l)));
      setSuccess("Lot marqué comme comptabilisé.");
    } catch (e: any) {
      setError(e.message || "Erreur lors de la comptabilisation.");
    } finally {
      setComptabilisationEnCours(false);
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-4 w-full max-w-4xl">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="px-6 py-4 space-y-3 w-full max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft size={18} className="text-muted-foreground" />
          </Button>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Export comptable</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Exporte les écritures d'un lot généré vers le logiciel comptable cible.
          </p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/30">
          {error}
        </div>
      )}
      {success && (
        <div
          className="px-4 py-3 rounded-lg text-sm flex items-center gap-2"
          style={{ background: `hsl(var(--success) / 0.1)`, color: `hsl(var(--success))`, boxShadow: `inset 0 0 0 1px hsl(var(--success) / 0.25)` }}
        >
          <CheckCircle2 size={14} /> {success}
        </div>
      )}

      {lots.length === 0 ? (
        <Card>
          <CardContent className="px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Aucun lot généré pour le moment.{" "}
              <button onClick={() => navigate("/paie/compta/generation")} className="text-accent font-semibold underline hover:no-underline">
                Générer des écritures
              </button>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Sélection</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Année</label>
                <Select value={selectedAnnee || undefined} onValueChange={handleAnneeChange}>
                  <SelectTrigger><SelectValue placeholder="— Sélectionner —" /></SelectTrigger>
                  <SelectContent>
                    {anneesDisponibles.map((a) => (
                      <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Mois</label>
                <Select value={selectedPeriode || undefined} onValueChange={handlePeriodeChange} disabled={!selectedAnnee}>
                  <SelectTrigger><SelectValue placeholder="— Sélectionner —" /></SelectTrigger>
                  <SelectContent>
                    {periodesDisponibles.map(([numero, intitule]) => (
                      <SelectItem key={numero} value={String(numero)}>
                        {String(numero).padStart(2, "0")}{intitule ? ` — ${intitule}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Lot</label>
                <Select value={selectedLotId || undefined} onValueChange={setSelectedLotId} disabled={!selectedPeriode}>
                  <SelectTrigger><SelectValue placeholder="— Sélectionner —" /></SelectTrigger>
                  <SelectContent>
                    {lotsFiltres.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.plan_paie_code} · {l.mode_generation === "GLOBAL" ? "Global" : "Nominatif"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Format d'export</label>
                <Select value={selectedFormat || undefined} onValueChange={setSelectedFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.code} value={f.code}>{f.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedLot && (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-xs text-muted-foreground">Statut du lot :</span>
                <StatutBadge statut={selectedLot.statut} />
                {selectedLot.controle_ok === false && (
                  <span className="text-xs" style={{ color: `hsl(var(--warning))` }}>
                    (généré avec forçage — {selectedLot.motif_forcage})
                  </span>
                )}
                {selectedLot.statut === "COMPTABILISE" && selectedLot.comptabilise_le && (
                  <span className="text-xs text-muted-foreground">
                    · comptabilisé le {new Date(selectedLot.comptabilise_le).toLocaleDateString("fr-MA")}
                    {selectedLot.comptabilise_par ? ` par ${selectedLot.comptabilise_par}` : ""}
                  </span>
                )}
                {selectedLot.statut === "COMPTABILISE" &&
                  selectedLot.comptabilise_generation != null &&
                  selectedLot.comptabilise_generation !== selectedLot.numero_generation && (
                    <span className="text-xs font-medium" style={{ color: `hsl(var(--destructive))` }}>
                      ⚠ régénéré depuis la comptabilisation (génération {selectedLot.comptabilise_generation} → {selectedLot.numero_generation})
                    </span>
                  )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={handleTelecharger}
                disabled={!selectedLotId || !selectedFormat || exporting}
                className="gap-2"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {exporting ? "Génération du fichier…" : "Télécharger"}
              </Button>
              {selectedLot?.statut === "EXPORTE" && (
                <Button
                  variant="outline"
                  onClick={handleComptabiliser}
                  disabled={comptabilisationEnCours}
                  className="gap-2"
                >
                  {comptabilisationEnCours ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Marquer comme comptabilisé
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historique des exports du lot */}
      {selectedLotId && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-1.5">
              <History size={14} /> Historique des exports
            </h3>
            {historique.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun export réalisé pour ce lot.</p>
            ) : (
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Fichier</TableHead>
                    <TableHead>Utilisateur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historique.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{h.exporte_le ? new Date(h.exporte_le).toLocaleString("fr-MA") : "—"}</TableCell>
                      <TableCell className="font-mono">{h.format_code}</TableCell>
                      <TableCell className="text-muted-foreground">{h.nom_fichier}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {h.exporte_par_nom
                          ? `${h.exporte_par_nom}${h.exporte_par_matricule ? ` (${h.exporte_par_matricule})` : ""}`
                          : h.exporte_par}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExportComptaPage;
