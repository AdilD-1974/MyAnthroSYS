/**
 * congeCalculs.ts — Fonctions de calcul de jours pour les congés.
 * Extraites de DemandeCongeForm.tsx pour être partagées avec
 * SaisieDirecteCongePage.tsx (consommation directe, sans passer par
 * cong_demandes) SANS dupliquer la logique de calcul.
 *
 * Toute évolution de ces règles (jours ouvrés/ouvrables, demi-journées,
 * jours fériés) doit se faire ICI UNIQUEMENT pour rester valable
 * pour les deux écrans.
 */

export function isJourFerie(date: Date, feriesDates: Set<string>): boolean {
  return feriesDates.has(date.toISOString().split("T")[0]);
}

export function isJourOuvre(date: Date, typeJour: string): boolean {
  const dow = date.getDay();
  if (typeJour === "OUV2") return dow >= 1 && dow <= 5;
  return dow !== 0;
}

export function calcJoursAvecType(
  debut: string,
  fin: string,
  debutDemi: string,
  finDemi: string,
  typeJour: string | null,
  feriesDates: Set<string>
): { cal: number; dec: number } {
  if (!debut || !fin) return { cal: 0, dec: 0 };
  const d1 = new Date(debut + "T00:00:00");
  const d2 = new Date(fin + "T00:00:00");
  if (d2 < d1) return { cal: 0, dec: 0 };
  let cal = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
  if (debutDemi === "APRES_MIDI") cal -= 0.5;
  if (finDemi === "MATIN") cal -= 0.5;
  const tj = typeJour || "CAL";
  if (tj === "CAL") return { cal, dec: cal };
  let dec = 0;
  const cursor = new Date(d1);
  while (cursor <= d2) {
    if (isJourOuvre(cursor, tj) && !isJourFerie(cursor, feriesDates)) dec += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  if (debutDemi === "APRES_MIDI" && isJourOuvre(d1, tj) && !isJourFerie(d1, feriesDates)) dec -= 0.5;
  if (finDemi === "MATIN" && isJourOuvre(d2, tj) && !isJourFerie(d2, feriesDates)) dec -= 0.5;
  dec = Math.max(0, dec);
  return { cal, dec };
}

export function calcDateFinAutoAbsence(debut: string, droitJours: number): string {
  if (!debut || droitJours <= 0) return debut;
  const [y, m, d] = debut.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + droitJours - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function calcDateRetour(
  fin: string,
  finDemi: string,
  typeJour?: string | null,
  feriesDates?: Set<string>
): string {
  if (!fin) return "";
  if (finDemi === "MATIN") return fin;
  const [y, m, d] = fin.split("-").map(Number);
  const cursor = new Date(y, m - 1, d);
  const tj = typeJour === "OUV" ? "OUV" : "OUV2";
  const feries = feriesDates ?? new Set<string>();
  let maxIter = 14;
  do {
    cursor.setDate(cursor.getDate() + 1);
    const dateStr = cursor.toISOString().split("T")[0];
    if (isJourOuvre(cursor, tj) && !feries.has(dateStr)) break;
  } while (--maxIter > 0);
  return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
}

export const typeJourLabel = (tj: string | null) =>
  tj === "OUV" ? "Ouvrés (lun-sam)" : tj === "OUV2" ? "Ouvrables (lun-ven)" : "Calendaires";
