// src/pages/paie/components/ImputationComptablePave.tsx
//
// Pavé "Imputation comptable" — à monter dans RubriqueForm.tsx, onglet
// Réglementaire.
//
// SCHÉMA DÉFINITIF de rubrique_paie_imputation (voir 23_comptabilite_paie.sql
// §1 pour l'historique) : id, rubrique_paie_code, part, compte_debit,
// compte_credit, axe_debit, axe_credit, date_debut, date_fin, actif,
// commentaire. Comptes en TEXTE LIBRE — pas de référentiel de plan comptable
// séparé (l'ancien référentiel ref_imputation_comptable et son embed dans les
// requêtes ne sont plus utilisables sur cette table).
//
// Passe par le proxy générique existant `/api/v1/db/rubrique_paie_imputation`
// (syntaxe PostgREST : eq., select=, order=), le même que celui déjà utilisé
// ailleurs dans l'application — pas de routeur custom dupliqué pour ce CRUD.

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";

export interface ImputationRow {
  id: string;
  rubrique_paie_code: string;
  part: "SALARIALE" | "PATRONALE" | "NEUTRE";
  compte_debit: string | null;
  compte_credit: string | null;
  axe_debit: string | null;
  axe_credit: string | null;
  date_debut: string;
  date_fin: string | null;
  actif: boolean;
  commentaire: string | null;
}

const TABLE = "rubrique_paie_imputation";

const dbProxy = {
  list: (rubriquePaieCode: string) =>
    apiClient.get<ImputationRow[]>(`/api/v1/db/${TABLE}`, {
      params: { rubrique_paie_code: `eq.${rubriquePaieCode}`, order: "part,compte_debit" },
    }),

  create: (payload: Partial<ImputationRow>) =>
    apiClient.post<ImputationRow>(`/api/v1/db/${TABLE}`, payload),

  update: (id: string, payload: Partial<ImputationRow>) =>
    apiClient.patch<ImputationRow>(`/api/v1/db/${TABLE}`, payload, { params: { id: `eq.${id}` } }),

  remove: (id: string) =>
    apiClient.delete(`/api/v1/db/${TABLE}`, { params: { id: `eq.${id}` } }),
};

interface Props {
  rubriquePaieCode: string;
  codeType: "GAIN" | "RETENUE" | "COT" | "ASS" | "CALC" | string;
  readOnly?: boolean;
}

type LigneEnEdition = Partial<ImputationRow>;

const PART_LABELS: Record<string, string> = {
  NEUTRE: "Unique",
  SALARIALE: "Part salariale",
  PATRONALE: "Part patronale",
};

export default function ImputationComptablePave({ rubriquePaieCode, codeType, readOnly }: Props) {
  const [imputations, setImputations] = useState<ImputationRow[]>([]);
  const [enEdition, setEnEdition] = useState<LigneEnEdition | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const estCotisation = codeType === "COT";

  useEffect(() => {
    if (!rubriquePaieCode) return;
    recharger();
  }, [rubriquePaieCode]);

  function recharger() {
    setChargement(true);
    dbProxy
      .list(rubriquePaieCode)
      .then(setImputations)
      .catch((e) => setErreur(e?.message ?? "Erreur de chargement des imputations."))
      .finally(() => setChargement(false));
  }

  function nouvelleLigne() {
    setEnEdition({
      rubrique_paie_code: rubriquePaieCode,
      part: estCotisation ? "SALARIALE" : "NEUTRE",
      compte_debit: "",
      compte_credit: "",
      axe_debit: "",
      axe_credit: "",
      date_debut: new Date().toISOString().slice(0, 10),
      date_fin: null,
      actif: true,
      commentaire: "",
    });
  }

  async function enregistrer() {
    if (!enEdition) return;
    if (!enEdition.compte_debit && !enEdition.compte_credit) {
      setErreur("Au moins un compte (débit ou crédit) est requis.");
      return;
    }
    setErreur(null);
    try {
      if (enEdition.id) {
        await dbProxy.update(enEdition.id, enEdition);
      } else {
        await dbProxy.create(enEdition);
      }
      setEnEdition(null);
      recharger();
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  async function supprimer(id: string) {
    if (!confirm("Supprimer cette imputation ?")) return;
    await dbProxy.remove(id);
    recharger();
  }

  const partsManquantes = estCotisation
    ? (["SALARIALE", "PATRONALE"] as const).filter(
        (p) => !imputations.some((i) => i.part === p && i.actif)
      )
    : [];

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">Imputation comptable</h3>
        {!readOnly && (
          <button onClick={nouvelleLigne} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
            + Ajouter une imputation
          </button>
        )}
      </div>

      {estCotisation && partsManquantes.length > 0 && (
        <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-700">
          Cotisation sans imputation {partsManquantes.map((p) => PART_LABELS[p]).join(" ni ")} —
          la génération d'écritures exclura ce(s) montant(s) (voir anomalies du lot).
        </p>
      )}

      {chargement ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : imputations.length === 0 && !enEdition ? (
        <p className="text-sm text-gray-500">Aucune imputation paramétrée pour cette rubrique.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              {estCotisation && <th>Part</th>}
              <th>Compte débit</th>
              <th>Compte crédit</th>
              <th>Axe débit</th>
              <th>Axe crédit</th>
              <th>Validité</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {imputations.map((imp) => (
              <tr key={imp.id} className={imp.actif ? "" : "text-gray-400 line-through"}>
                {estCotisation && <td>{PART_LABELS[imp.part]}</td>}
                <td>{imp.compte_debit || "—"}</td>
                <td>{imp.compte_credit || "—"}</td>
                <td>{imp.axe_debit || "—"}</td>
                <td>{imp.axe_credit || "—"}</td>
                <td>{imp.date_debut} → {imp.date_fin ?? "en cours"}</td>
                {!readOnly && (
                  <td className="space-x-2">
                    <button onClick={() => setEnEdition(imp)} className="text-blue-600">Modifier</button>
                    <button onClick={() => supprimer(imp.id)} className="text-red-600">Supprimer</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {enEdition && (
        <div className="mt-4 space-y-3 rounded border bg-gray-50 p-3">
          {estCotisation && (
            <label className="flex items-center gap-2">
              <span className="w-32 text-sm">Part</span>
              <select
                value={enEdition.part}
                onChange={(e) => setEnEdition({ ...enEdition, part: e.target.value as any })}
                className="rounded border px-2 py-1"
              >
                <option value="SALARIALE">Part salariale</option>
                <option value="PATRONALE">Part patronale</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="w-32 text-sm">Compte débit</span>
            <input
              value={enEdition.compte_debit ?? ""}
              onChange={(e) => setEnEdition({ ...enEdition, compte_debit: e.target.value })}
              className="flex-1 rounded border px-2 py-1"
              placeholder="ex. 617000"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 text-sm">Compte crédit</span>
            <input
              value={enEdition.compte_credit ?? ""}
              onChange={(e) => setEnEdition({ ...enEdition, compte_credit: e.target.value })}
              className="flex-1 rounded border px-2 py-1"
              placeholder="ex. 443200"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 text-sm">Axe débit</span>
            <input
              value={enEdition.axe_debit ?? ""}
              onChange={(e) => setEnEdition({ ...enEdition, axe_debit: e.target.value })}
              className="flex-1 rounded border px-2 py-1"
              placeholder="code analytique ou HERITE_UO"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-32 text-sm">Axe crédit</span>
            <input
              value={enEdition.axe_credit ?? ""}
              onChange={(e) => setEnEdition({ ...enEdition, axe_credit: e.target.value })}
              className="flex-1 rounded border px-2 py-1"
              placeholder="code analytique ou HERITE_UO"
            />
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <span className="w-32 text-sm">Début validité</span>
              <input
                type="date"
                value={enEdition.date_debut ?? ""}
                onChange={(e) => setEnEdition({ ...enEdition, date_debut: e.target.value })}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm">Fin validité</span>
              <input
                type="date"
                value={enEdition.date_fin ?? ""}
                onChange={(e) => setEnEdition({ ...enEdition, date_fin: e.target.value || null })}
                className="rounded border px-2 py-1"
              />
            </label>
          </div>

          {erreur && <p className="text-sm text-red-600">{erreur}</p>}

          <div className="flex gap-2">
            <button onClick={enregistrer} className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
              Enregistrer
            </button>
            <button onClick={() => setEnEdition(null)} className="rounded border px-3 py-1 text-sm">
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
