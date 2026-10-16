// src/components/prets/CreationDirectePretDialog.tsx
//
// Saisie directe par un Gestionnaire RH/Administrateur (dossier fonctionnel
// §5.2/§5.3) : prêt externe, reprise d'historique, ou création directe sans
// passer par le self-service. Aucun circuit de validation n'est déclenché.
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  pretsApi, TypePretAdmin, SimulationPretResponse, formatMontant,
} from "@/lib/pretsApi";
import { db } from "@/lib/api";
import CollaborateurPicker from "@/components/CollaborateurPicker";

export interface CreationDirectePretDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreationDirectePretDialog: React.FC<CreationDirectePretDialogProps> = ({ open, onClose, onSuccess }) => {
  const [types, setTypes] = useState<TypePretAdmin[]>([]);
  const [banques, setBanques] = useState<{ code: string; libelle: string }[]>([]);
  const [collaborateurId, setCollaborateurId] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [montant, setMontant] = useState("");
  const [nbEcheance, setNbEcheance] = useState("");
  const [tauxOverride, setTauxOverride] = useState("");
  const [tauxTva, setTauxTva] = useState("");
  const [datePremiere, setDatePremiere] = useState(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [objet, setObjet] = useState("");
  const [motif, setMotif] = useState("");
  const [refPret, setRefPret] = useState("");
  const [mtEcheancePlus, setMtEcheancePlus] = useState("");
  const [dateDebutRemb, setDateDebutRemb] = useState("");
  const [dateDebutPret, setDateDebutPret] = useState("");
  const [justificatifFourni, setJustificatifFourni] = useState(false);
  const [justificatifDate, setJustificatifDate] = useState("");
  const [observationsRh, setObservationsRh] = useState("");
  const [dejaDebloque, setDejaDebloque] = useState(false);
  const [montantDebloque, setMontantDebloque] = useState("");
  const [dateDeblocage, setDateDeblocage] = useState("");
  const [capitalRestantSaisie, setCapitalRestantSaisie] = useState("");
  const [organismeCredit, setOrganismeCredit] = useState("");
  const [etabCredit, setEtabCredit] = useState("");
  const [codeBqe, setCodeBqe] = useState("");
  const [codeGuichet, setCodeGuichet] = useState("");
  const [noCompte, setNoCompte] = useState("");
  const [clerib, setClerib] = useState("");
  const [intituleCompte, setIntituleCompte] = useState("");
  const [hypotheque, setHypotheque] = useState(false);
  const [reconnaissanceDette, setReconnaissanceDette] = useState(false);

  const [simulation, setSimulation] = useState<SimulationPretResponse | null>(null);
  const [chargementSim, setChargementSim] = useState(false);
  const [soumission, setSoumission] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    pretsApi.listerTypesAdmin()
      .then(all => setTypes(all.filter(t => t.actif)))
      .catch(() => setErreur("Impossible de charger les types de prêt — vérifiez que le serveur est joignable."));
    db.list<{ code: string; libelle: string }>("ref_banque", { actif: true, order: "libelle", select: "code,libelle" })
      .then(setBanques)
      .catch(() => setBanques([]));
  }, [open]);

  const typeSelectionne = types.find(t => t.code === typeCode) ?? null;
  const estExterne = typeSelectionne?.origine_code === "EXTERNE";

  useEffect(() => {
    setSimulation(null); setErreur(null);
    const m = Number(montant), n = Number(nbEcheance);
    if (!typeCode || !m || m <= 0 || !n || n <= 0 || !datePremiere) return;
    const t = setTimeout(() => {
      setChargementSim(true);
      pretsApi.simuler({
        type_code: typeCode, montant: m, nb_echeance: n, date_premiere_echeance: datePremiere,
        taux_annuel: tauxOverride ? Number(tauxOverride) : undefined,
        taux_tva: tauxTva ? Number(tauxTva) : undefined,
      }).then(setSimulation).catch((e: any) => setErreur(e?.message ?? "Erreur lors de la simulation.")).finally(() => setChargementSim(false));
    }, 400);
    return () => clearTimeout(t);
  }, [typeCode, montant, nbEcheance, datePremiere, tauxOverride, tauxTva]);

  const reinitialiser = () => {
    setCollaborateurId(""); setTypeCode(""); setMontant(""); setNbEcheance(""); setTauxOverride(""); setTauxTva("");
    setObjet(""); setMotif(""); setRefPret(""); setMtEcheancePlus(""); setDateDebutPret(""); setDateDebutRemb("");
    setJustificatifFourni(false); setJustificatifDate(""); setObservationsRh("");
    setDejaDebloque(false); setMontantDebloque(""); setDateDeblocage("");
    setCapitalRestantSaisie(""); setOrganismeCredit(""); setEtabCredit(""); setCodeBqe(""); setCodeGuichet("");
    setNoCompte(""); setClerib(""); setIntituleCompte(""); setHypotheque(false); setReconnaissanceDette(false);
    setSimulation(null); setErreur(null);
  };

  const fermer = () => { reinitialiser(); onClose(); };

  const soumettre = async () => {
    setSoumission(true); setErreur(null);
    try {
      await pretsApi.creerDirect({
        collaborateur_id: collaborateurId, type_code: typeCode, montant: Number(montant), nb_echeance: Number(nbEcheance),
        taux_annuel: tauxOverride ? Number(tauxOverride) : undefined,
        taux_tva: tauxTva ? Number(tauxTva) : undefined,
        date_premiere_echeance: datePremiere, objet: objet || undefined, motif: motif || undefined,
        ref_pret: refPret || undefined,
        mt_echeance_plus: mtEcheancePlus ? Number(mtEcheancePlus) : undefined,
        dt_debut_pret: dateDebutPret || undefined,
        dt_debut_remb: dateDebutRemb || undefined,
        justificatif_fourni: justificatifFourni,
        justificatif_date: justificatifFourni && justificatifDate ? justificatifDate : undefined,
        observations_rh: observationsRh || undefined,
        deja_debloque: dejaDebloque,
        montant_debloque: dejaDebloque && montantDebloque ? Number(montantDebloque) : undefined,
        date_deblocage: dejaDebloque && dateDeblocage ? dateDeblocage : undefined,
        capital_restant_saisie: capitalRestantSaisie ? Number(capitalRestantSaisie) : undefined,
        organisme_credit: organismeCredit || undefined,
        etab_credit: etabCredit || undefined,
        code_bqe: codeBqe || undefined,
        code_guichet: codeGuichet || undefined,
        no_compte: noCompte || undefined,
        clerib: clerib || undefined,
        intitule_compte: intituleCompte || undefined,
        hypotheque, reconnaissance_dette: reconnaissanceDette,
      });
      onSuccess();
      fermer();
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la création du dossier.");
    } finally {
      setSoumission(false);
    }
  };

  const pretValide = collaborateurId && typeCode && Number(montant) > 0 && Number(nbEcheance) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) fermer(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Nouveau dossier (saisie directe)</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[11px] rounded-md p-2" style={{ background: "hsl(var(--info) / 0.08)", color: "hsl(var(--info))" }}>
            Aucun circuit de validation n'est déclenché — le dossier est créé directement "Validé"
            (ou "Débloqué" si vous indiquez qu'il l'est déjà, typique d'une reprise).
          </p>

          <Accordion type="multiple" defaultValue={["general"]} className="space-y-3">

            <AccordionItem value="general" className="rounded-md border border-border px-3">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:no-underline">
                Général
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Collaborateur</Label>
                    <CollaborateurPicker value={collaborateurId} onChange={setCollaborateurId} placeholder="Choisir un collaborateur…" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Type de prêt</Label>
                    <select
                      className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={typeCode} onChange={e => setTypeCode(e.target.value)}
                    >
                      <option value="">Sélectionnez un type</option>
                      {types.map(t => <option key={t.code} value={t.code}>{t.libelle}</option>)}
                    </select>
                    {types.length === 0 && !erreur && (
                      <p className="text-[11px] mt-1" style={{ color: "hsl(var(--warning))" }}>
                        Aucun type de prêt actif trouvé — créez-en un dans Paramétrage des prêts.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Montant (DH)</Label>
                    <Input type="number" min={0} value={montant} onChange={e => setMontant(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Durée (mois)</Label>
                    <Input type="number" min={1} value={nbEcheance} onChange={e => setNbEcheance(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Taux annuel % (optionnel)</Label>
                    <Input type="number" min={0} step="0.01" value={tauxOverride} onChange={e => setTauxOverride(e.target.value)}
                      placeholder={typeSelectionne ? `Défaut ${typeSelectionne.taux_annuel_defaut}%` : ""} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Taux de TVA % (optionnel)</Label>
                    <Input type="number" min={0} step="0.01" value={tauxTva} onChange={e => setTauxTva(e.target.value)} placeholder="0" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs mb-1 block">Date de la première échéance</Label>
                  <Input type="date" value={datePremiere} onChange={e => setDatePremiere(e.target.value)} className="max-w-xs" />
                </div>

                {chargementSim && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" /> Calcul de la simulation…
                  </div>
                )}
                {simulation && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Mensualité</p>
                      <p className="text-sm font-semibold">{formatMontant(simulation.mensualite_theorique)}</p>
                    </div>
                    <div className="rounded-md border border-border p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Nb échéances</p>
                      <p className="text-sm font-semibold">{simulation.nb_echeance_retenu}</p>
                    </div>
                    <div className="rounded-md border border-border p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Coût intérêts</p>
                      <p className="text-sm font-semibold">{formatMontant(simulation.cout_total_interets)}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Objet</Label>
                    <Textarea rows={2} value={objet} onChange={e => setObjet(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Motif / précisions (optionnel)</Label>
                    <Textarea rows={2} value={motif} onChange={e => setMotif(e.target.value)} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="complementaire" className="rounded-md border border-border px-3">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:no-underline">
                Caractéristiques complémentaires
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Date de début du prêt (contraction)</Label>
                    <Input type="date" value={dateDebutPret} onChange={e => setDateDebutPret(e.target.value)} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Indépendante de la date de saisie ou de validation — c'est la date à laquelle le prêt a réellement
                      débuté chez l'établissement de crédit.
                      {dateDebutPret && nbEcheance && Number(nbEcheance) > 0 && (() => {
                        const d = new Date(dateDebutPret);
                        d.setMonth(d.getMonth() + Number(nbEcheance));
                        return <> Fin prévue calculée : <strong>{d.toLocaleDateString("fr-FR")}</strong>.</>;
                      })()}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">N° de dossier (optionnel)</Label>
                    <Input value={refPret} onChange={e => setRefPret(e.target.value)} placeholder="Généré automatiquement si vide" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Prélever en plus (DH, optionnel)</Label>
                    <Input type="number" min={0} value={mtEcheancePlus} onChange={e => setMtEcheancePlus(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Date de début de remboursement</Label>
                    <Input type="date" value={dateDebutRemb} onChange={e => setDateDebutRemb(e.target.value)} />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Si antérieure à la première échéance, le nombre de mois d'écart est traité comme un différé.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={justificatifFourni} onChange={e => setJustificatifFourni(e.target.checked)} />
                  Justificatif fourni
                </label>
                {justificatifFourni && (
                  <div className="max-w-xs">
                    <Label className="text-xs mb-1 block">Date du justificatif</Label>
                    <Input type="date" value={justificatifDate} onChange={e => setJustificatifDate(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label className="text-xs mb-1 block">Observations RH (internes)</Label>
                  <Textarea rows={2} value={observationsRh} onChange={e => setObservationsRh(e.target.value)} />
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="banque" className="rounded-md border border-border px-3">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:no-underline">
                Banque{estExterne ? " (organisme prêteur externe)" : ""}
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1">
                {estExterne && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Organisme de crédit</Label>
                      <Input value={organismeCredit} onChange={e => setOrganismeCredit(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Établissement de crédit</Label>
                      <Input value={etabCredit} onChange={e => setEtabCredit(e.target.value)} />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Banque</Label>
                    <select
                      className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={codeBqe} onChange={e => setCodeBqe(e.target.value)}
                    >
                      <option value="">Sélectionner une banque</option>
                      {banques.map(b => <option key={b.code} value={b.code}>{b.libelle}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Code guichet</Label>
                    <Input value={codeGuichet} onChange={e => setCodeGuichet(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">N° compte</Label>
                    <Input value={noCompte} onChange={e => setNoCompte(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Clé RIB</Label>
                    <Input value={clerib} onChange={e => setClerib(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs mb-1 block">Intitulé du compte</Label>
                    <Input value={intituleCompte} onChange={e => setIntituleCompte(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={hypotheque} onChange={e => setHypotheque(e.target.checked)} />
                    Hypothèque
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={reconnaissanceDette} onChange={e => setReconnaissanceDette(e.target.checked)} />
                    Reconnaissance de dette
                  </label>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="reprise" className="rounded-md border border-border px-3">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:no-underline">
                Reprise{dejaDebloque ? " (déjà débloqué)" : ""}
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dejaDebloque} onChange={e => setDejaDebloque(e.target.checked)} />
                  Ce prêt est une reprise déjà débloquée (l'argent a déjà été versé ailleurs)
                </label>
                {dejaDebloque && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Montant débloqué</Label>
                      <Input type="number" value={montantDebloque} onChange={e => setMontantDebloque(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Date de déblocage</Label>
                      <Input type="date" value={dateDeblocage} onChange={e => setDateDeblocage(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Capital restant dû (à la reprise)</Label>
                      <Input type="number" value={capitalRestantSaisie} onChange={e => setCapitalRestantSaisie(e.target.value)} />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

          </Accordion>

          {erreur && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle size={13} /> {erreur}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fermer}>Annuler</Button>
          <Button onClick={soumettre} disabled={!pretValide || soumission}>
            {soumission && <Loader2 size={14} className="mr-2 animate-spin" />}
            Créer le dossier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreationDirectePretDialog;
