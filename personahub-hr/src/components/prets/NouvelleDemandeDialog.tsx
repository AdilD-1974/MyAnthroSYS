// NouvelleDemandeDialog.tsx — Formulaire de demande de prêt (interne & externe)
// src/components/prets/NouvelleDemandeDialog.tsx
//
// Routing selon le type :
//   Interne → formulaire court (montant, durée, motif)
//   Externe → formulaire étendu (+ organisme, compte bancaire, coordonnées cession)
// Simulateur embarqué avec adoption des paramètres.

import React, { useState, useEffect } from "react";
import { Banknote, Building2, Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  pretsApi, PretConfig, PretAlgo, ALGO_LABELS, formatMontant,
} from "@/lib/pretsApi";
import SimulateurPret from "./SimulateurPret";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const NouvelleDemandeDialog: React.FC<Props> = ({ open, onClose, onSuccess }) => {
  const [configs, setConfigs] = useState<PretConfig[]>([]);
  const [tab, setTab] = useState<"formulaire" | "simulateur">("formulaire");

  // Type de prêt
  const [pretInterne, setPretInterne] = useState(true);

  // Paramètres financiers
  const [montant, setMontant] = useState(10000);
  const [nbEcheances, setNbEcheances] = useState(12);
  const [taux, setTaux] = useState(0);
  const [algo, setAlgo] = useState<PretAlgo>("french_amortissement");

  // Champs communs
  const [motif, setMotif] = useState("");

  // Champs externes
  const [organismeCredit, setOrganismeCredit] = useState("");
  const [etabCredit, setEtabCredit] = useState("");
  const [codeBqe, setCodeBqe] = useState("");
  const [noCompte, setNoCompte] = useState("");
  const [clerib, setClerib] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    pretsApi.getConfig().then(setConfigs).catch(() => {});
    // Reset
    setTab("formulaire");
    setMotif("");
    setGlobalError(null);
    setErrors({});
    setOrganismeCredit("");
    setEtabCredit("");
    setCodeBqe("");
    setNoCompte("");
    setClerib("");
  }, [open]);

  const configInterne = configs.find(c => c.code === "PLAFOND_INTERNE_ANNUEL");
  const montantMax = configInterne?.valeur ?? 100000;
  const dureeMax = 48;

  // Validation
  const valider = (): boolean => {
    const e: Record<string, string> = {};
    if (montant <= 0) e.montant = "Montant invalide.";
    if (montant > montantMax) e.montant = `Montant supérieur au plafond (${formatMontant(montantMax)}).`;
    if (nbEcheances < 1 || nbEcheances > dureeMax) e.nb = `Durée entre 1 et ${dureeMax} mois.`;
    if (motif.trim().length < 10) e.motif = "Le motif doit comporter au moins 10 caractères.";
    if (!pretInterne) {
      if (!organismeCredit.trim()) e.org = "L'organisme de crédit est obligatoire.";
      if (!noCompte.trim()) e.compte = "Le numéro de compte est obligatoire.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const soumettre = async () => {
    if (!valider()) return;
    setSubmitting(true);
    setGlobalError(null);
    try {
      await pretsApi.soumettreDemande({
        pret_interne: pretInterne,
        montant,
        nb_echeances: nbEcheances,
        taux: pretInterne ? 0 : taux, // taux = 0 pour les internes (ou selon config)
        algo,
        inclure_interets: true,
        organisme_credit: pretInterne ? undefined : organismeCredit,
        etab_credit: pretInterne ? undefined : etabCredit,
        code_bqe: pretInterne ? undefined : codeBqe,
        no_compte: pretInterne ? undefined : noCompte,
        clerib: pretInterne ? undefined : clerib,
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      const detail = e?.detail;
      if (Array.isArray(detail)) {
        setGlobalError(detail.join(" — "));
      } else {
        setGlobalError(detail ?? "Erreur lors de la soumission.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const Field: React.FC<{ label: string; error?: string; required?: boolean; children: React.ReactNode }> = ({
    label, error, required, children,
  }) => (
    <div>
      <Label className="text-xs mb-1.5 block">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-[11px] text-destructive mt-0.5">{error}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle demande de prêt</DialogTitle>
        </DialogHeader>

        {/* Sélecteur de type */}
        <div className="grid grid-cols-2 gap-3 mb-1">
          <button
            type="button"
            onClick={() => setPretInterne(true)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
              pretInterne ? "border-primary bg-primary/5" : "hover:bg-secondary/50"
            }`}
          >
            <Banknote size={20} className={pretInterne ? "text-primary" : "text-muted-foreground"} />
            <div>
              <p className="text-sm font-medium">Prêt interne</p>
              <p className="text-[11px] text-muted-foreground">L'entreprise prête directement</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setPretInterne(false)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
              !pretInterne ? "border-primary bg-primary/5" : "hover:bg-secondary/50"
            }`}
          >
            <Building2 size={20} className={!pretInterne ? "text-primary" : "text-muted-foreground"} />
            <div>
              <p className="text-sm font-medium">Cession externe</p>
              <p className="text-[11px] text-muted-foreground">Banque → prélèvement sur salaire</p>
            </div>
          </button>
        </div>

        {pretInterne && (
          <div className="flex items-start gap-1.5 rounded bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-700">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            Les prêts internes sont sans intérêts selon votre convention. La mensualité est déduite automatiquement de votre bulletin de paie.
          </div>
        )}
        {!pretInterne && (
          <div className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            La cession sur salaire transfère automatiquement la mensualité à votre banque. En cas de départ, la cession est annulée et le remboursement redevient votre responsabilité directe.
          </div>
        )}

        {/* Onglets formulaire / simulateur */}
        <Tabs value={tab} onValueChange={v => setTab(v as any)}>
          <TabsList className="mb-3">
            <TabsTrigger value="formulaire">Paramètres</TabsTrigger>
            <TabsTrigger value="simulateur">Simuler d'abord</TabsTrigger>
          </TabsList>

          {/* ── FORMULAIRE ─────────────────────────────────── */}
          <TabsContent value="formulaire" className="space-y-4">
            {/* Paramètres financiers */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant demandé (MAD)" error={errors.montant} required>
                <Input
                  type="number" value={montant} min={100} max={montantMax} step={500}
                  onChange={e => setMontant(Number(e.target.value))}
                  className={errors.montant ? "border-destructive" : ""}
                />
              </Field>
              <Field label="Durée de remboursement (mois)" error={errors.nb} required>
                <Input
                  type="number" value={nbEcheances} min={1} max={dureeMax}
                  onChange={e => setNbEcheances(Number(e.target.value))}
                  className={errors.nb ? "border-destructive" : ""}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {!pretInterne && (
                <Field label="Taux annuel (%)">
                  <Input
                    type="number" value={taux} min={0} max={30} step={0.25}
                    onChange={e => setTaux(Number(e.target.value))}
                  />
                </Field>
              )}
              <Field label="Méthode de calcul">
                <Select value={algo} onValueChange={v => setAlgo(v as PretAlgo)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ALGO_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Champs externes */}
            {!pretInterne && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-xs font-medium">Établissement prêteur</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Organisme de crédit" error={errors.org} required>
                    <Input value={organismeCredit} onChange={e => setOrganismeCredit(e.target.value)}
                      placeholder="Ex: CIH, Attijariwafa, BMCE…" className={errors.org ? "border-destructive" : ""} />
                  </Field>
                  <Field label="Établissement (code)">
                    <Input value={etabCredit} onChange={e => setEtabCredit(e.target.value)} placeholder="Ex: BMCE" />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Code banque">
                    <Input value={codeBqe} onChange={e => setCodeBqe(e.target.value)} placeholder="007" maxLength={5} />
                  </Field>
                  <Field label="N° de compte" error={errors.compte} required>
                    <Input value={noCompte} onChange={e => setNoCompte(e.target.value)}
                      placeholder="0123456789" className={errors.compte ? "border-destructive" : ""} />
                  </Field>
                  <Field label="Clé RIB">
                    <Input value={clerib} onChange={e => setClerib(e.target.value)} placeholder="00" maxLength={2} />
                  </Field>
                </div>
              </div>
            )}

            {/* Motif */}
            <Field label="Motif de la demande" error={errors.motif} required>
              <Textarea
                value={motif}
                onChange={e => setMotif(e.target.value)}
                rows={3}
                placeholder="Décrivez la raison de votre demande (10 caractères minimum)…"
                className={errors.motif ? "border-destructive" : ""}
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">{motif.length} / 1000</p>
            </Field>

            {globalError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-red-50/50 px-3 py-2">
                {globalError}
              </p>
            )}
          </TabsContent>

          {/* ── SIMULATEUR ─────────────────────────────────── */}
          <TabsContent value="simulateur">
            <SimulateurPret
              montantInitial={montant}
              nbEcheancesInitial={nbEcheances}
              tauxInitial={taux}
              algoInitial={algo}
              montantMax={montantMax}
              dureeMaxMois={dureeMax}
              showAdopter
              onAdopter={p => {
                setMontant(p.montant);
                setNbEcheances(p.nb_echeances);
                setTaux(p.taux);
                setAlgo(p.algo);
                setTab("formulaire");
              }}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={soumettre} disabled={submitting || tab === "simulateur"}>
            {submitting ? "Envoi en cours…" : "Soumettre la demande"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NouvelleDemandeDialog;
