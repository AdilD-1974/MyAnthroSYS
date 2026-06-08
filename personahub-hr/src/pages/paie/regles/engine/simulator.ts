/**
 * simulator.ts — Mini-moteur d'évaluation des règles spécifiques (mode simulation).
 * Supporte : registres R01..R99, accesseurs MT./NB./TY./MTC./NBC./MTP./NBP./TYP./DTP.
 * Opérateurs : + - * / %, @MIN, @MAX, @TAB <BAREME>, branchements SI <cond> BRANCH <label>.
 * Sorties : MT, NB, TY, BASE.
 *
 * NB : Implémentation pédagogique (pas un évaluateur de prod). Suffisant pour vérifier
 * la cohérence d'une règle avant mise en production.
 */

export type AccessorKind = "MT" | "NB" | "TY" | "MTC" | "NBC" | "MTP" | "NBP" | "TYP" | "DTP";

export interface SimulationContext {
  /** Valeurs des accesseurs par rubrique : map[KIND][RUB] = number|string (DTP) */
  rubriques: Partial<Record<AccessorKind, Record<string, number | string>>>;
  /** Barèmes pour @TAB : map[BAREME] = [{cle, valeur}] */
  baremes?: Record<string, Array<{ cle: number | string; valeur: number }>>;
  /** Date du jour / date de paie (ISO) */
  dateJour?: string;
  datePaie?: string;
}

export interface SimulationStep {
  numero: number;
  instruction: string;
  resolu: string;
  affectation?: { cible: string; valeur: number | string };
  branchement?: { vers: string; pris: boolean };
  erreur?: string;
}

export interface SimulationResult {
  ok: boolean;
  registres: Record<string, number>;
  sorties: Partial<Record<"MT" | "NB" | "TY" | "BASE", number>>;
  trace: SimulationStep[];
  erreurGlobale?: string;
  /** Indique si l'exécution s'est terminée par une instruction FIN/END/STOP */
  finExplicite?: boolean;
}

interface ParsedLine {
  numero: number;
  instruction: string;
  label: string | null;
}

/** Parse une ligne d'instruction (tableur ou texte) */
export function parseInstructionLine(raw: string, fallbackNum: number): ParsedLine {
  let body = raw.trim();
  // numéro éventuel en tête
  const m = body.match(/^(\d+)\s+(.+)$/);
  let numero = fallbackNum;
  if (m) {
    numero = parseInt(m[1], 10);
    body = m[2];
  }
  // commentaire
  const cIdx = body.indexOf(";");
  if (cIdx >= 0) body = body.slice(0, cIdx).trim();
  // label
  let label: string | null = null;
  const lblMatch = body.match(/\s:(\w+)\s*$/);
  if (lblMatch) {
    label = lblMatch[1];
    body = body.replace(/\s:\w+\s*$/, "").trim();
  }
  return { numero, instruction: body, label };
}

const ACCESSOR_RE = /\b(MT|NB|TY|MTC|NBC|MTP|NBP|TYP|DTP)\.([A-Z0-9_]+)\b/g;

/** Résout les accesseurs Rxx, MT.XXX, etc. en valeurs numériques */
function resolveTokens(
  expr: string,
  registres: Record<string, number>,
  ctx: SimulationContext
): { resolu: string; missing: string[] } {
  const missing: string[] = [];
  // 1) Accesseurs typés (MT.RUB, NBP.RUB, etc.)
  let out = expr.replace(ACCESSOR_RE, (_full, kind: string, rub: string) => {
    const k = kind as AccessorKind;
    const v = ctx.rubriques?.[k]?.[rub];
    if (v === undefined || v === null) {
      missing.push(`${kind}.${rub}`);
      return "0";
    }
    return String(v);
  });
  // 2) Registres Rxx
  out = out.replace(/\bR(\d{2})\b/g, (_full, n: string) => {
    const key = `R${n}`;
    return String(registres[key] ?? 0);
  });
  // 3) Constantes spéciales
  if (ctx.dateJour) out = out.replace(/\bDATEJOUR\b/g, `"${ctx.dateJour}"`);
  if (ctx.datePaie) out = out.replace(/\bDATEPAIE\b/g, `"${ctx.datePaie}"`);
  return { resolu: out, missing };
}

/** Évalue une expression arithmétique simple : + - * / % @MIN @MAX @TAB */
function evalArith(expr: string, ctx: SimulationContext): number {
  let s = expr.trim();

  // @TAB <BAREME> : "X @TAB IGR"
  const tabMatch = s.match(/^(.+?)\s*@TAB\s+([A-Z0-9_]+)\s*$/i);
  if (tabMatch) {
    const base = evalArith(tabMatch[1], ctx);
    const baremeKey = tabMatch[2].toUpperCase();
    const bareme = ctx.baremes?.[baremeKey] || [];
    // Lookup par tranches : prend la dernière clé <= base
    let valeur = 0;
    for (const ligne of bareme) {
      const cle = typeof ligne.cle === "string" ? parseFloat(ligne.cle) : ligne.cle;
      if (cle <= base) valeur = ligne.valeur;
    }
    return valeur;
  }

  // @MIN / @MAX : "A @MIN B"
  const minMatch = s.match(/^(.+?)\s*@(MIN|MAX)\s*(.+)$/i);
  if (minMatch) {
    const a = evalArith(minMatch[1], ctx);
    const b = evalArith(minMatch[3], ctx);
    return minMatch[2].toUpperCase() === "MIN" ? Math.min(a, b) : Math.max(a, b);
  }

  // % spécifique : "A % B" → A * B / 100
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*(\d+(?:\.\d+)?)/g, (_m, a, b) => String((parseFloat(a) * parseFloat(b)) / 100));

  // Évaluation arithmétique sécurisée.
  // IMPORTANT : on valide strictement que l'expression ne contient que des
  // opérandes numériques et des opérateurs arithmétiques avant tout eval.
  // Aucun identifiant, mot-clé ou symbole étranger ne doit passer ce filtre.
  if (!/^[\d\s+\-*/.()]+$/.test(s)) {
    // L'expression contient des jetons non résolus → on retourne 0
    // sans lever d'exception pour ne pas interrompre la simulation.
    return 0;
  }
  // Double-vérification : longueur raisonnable (évite les DoS par expression géante)
  if (s.length > 512) {
    return 0;
  }
  try {
    // new Function est acceptable ici car l'expression est entièrement filtrée
    // ci-dessus : seuls des chiffres et opérateurs arithmétiques passent le regex.
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${s});`);
    const v = fn();
    return typeof v === "number" && isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** Évalue une condition "A op B" → boolean */
function evalCondition(cond: string, ctx: SimulationContext): boolean {
  const m = cond.match(/^(.+?)\s*(=|<>|!=|<=|>=|<|>)\s*(.+)$/);
  if (!m) return false;
  const a = evalArith(m[1], ctx);
  const op = m[2];
  const b = evalArith(m[3], ctx);
  switch (op) {
    case "=": return a === b;
    case "<>":
    case "!=": return a !== b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
  }
  return false;
}

/**
 * Simule l'exécution d'une règle spécifique sur un contexte donné.
 */
export function simulateRegle(
  lignes: Array<{ numero: number; instruction: string; label?: string | null }>,
  ctx: SimulationContext
): SimulationResult {
  const registres: Record<string, number> = {};
  const sorties: SimulationResult["sorties"] = {};
  const trace: SimulationStep[] = [];

  // Tri par numéro
  const ordered = [...lignes]
    .filter((l) => l.instruction && l.instruction.trim())
    .sort((a, b) => a.numero - b.numero);

  // Index des labels pour les BRANCH
  const labelIndex: Record<string, number> = {};
  ordered.forEach((l, idx) => {
    if (l.label) labelIndex[l.label.toUpperCase()] = idx;
  });

  let i = 0;
  let safety = 0;
  let finExplicite = false;
  while (i < ordered.length) {
    if (++safety > 1000) {
      return { ok: false, registres, sorties, trace, erreurGlobale: "Boucle d'exécution (>1000 itérations)" };
    }
    const l = ordered[i];
    const step: SimulationStep = { numero: l.numero, instruction: l.instruction, resolu: "" };

    // FIN / END / STOP : arrêt explicite du traitement
    const finMatch = l.instruction.match(/^\s*(FIN|END|STOP|FINTRT|FIN_TRT)\s*$/i);
    if (finMatch) {
      step.resolu = finMatch[1].toUpperCase();
      step.branchement = { vers: "FIN", pris: true };
      trace.push(step);
      finExplicite = true;
      break;
    }

    // BRANCH <label> inconditionnel (alias GOTO/ALLER)
    const gotoMatch = l.instruction.match(/^\s*(?:BRANCH|GOTO|ALLER)\s+(\w+)\s*$/i);
    if (gotoMatch) {
      const target = gotoMatch[1].toUpperCase();
      step.resolu = `BRANCH ${target}`;
      step.branchement = { vers: target, pris: true };
      trace.push(step);
      // Cible spéciale : FIN / END / STOP → terminer
      if (["FIN", "END", "STOP", "FINTRT", "FIN_TRT"].includes(target)) {
        finExplicite = true;
        break;
      }
      const tIdx = labelIndex[target];
      if (tIdx === undefined) {
        step.erreur = `Label introuvable : ${target}`;
        return { ok: false, registres, sorties, trace, erreurGlobale: step.erreur };
      }
      i = tIdx + 1;
      continue;
    }

    // SI <cond> BRANCH <label>
    const branchMatch = l.instruction.match(/^SI\s+(.+?)\s+BRANCH\s+(\w+)\s*$/i);
    if (branchMatch) {
      const condStr = branchMatch[1];
      const target = branchMatch[2].toUpperCase();
      const { resolu } = resolveTokens(condStr, registres, ctx);
      step.resolu = `SI ${resolu} BRANCH ${target}`;
      const taken = evalCondition(resolu, ctx);
      step.branchement = { vers: target, pris: taken };
      trace.push(step);
      if (taken) {
        // Cible spéciale FIN/END/STOP → arrêt
        if (["FIN", "END", "STOP", "FINTRT", "FIN_TRT"].includes(target)) {
          finExplicite = true;
          break;
        }
        const tIdx = labelIndex[target];
        if (tIdx === undefined) {
          step.erreur = `Label introuvable : ${target}`;
          return { ok: false, registres, sorties, trace, erreurGlobale: step.erreur };
        }
        i = tIdx + 1;
        continue;
      }
      i++;
      continue;
    }

    // Affectation : <CIBLE> = <expr>
    const assignMatch = l.instruction.match(/^(R\d{2}|MT|NB|TY|BASE)\s*=\s*(.+)$/i);
    if (assignMatch) {
      const cible = assignMatch[1].toUpperCase();
      const exprRaw = assignMatch[2];
      const { resolu, missing } = resolveTokens(exprRaw, registres, ctx);
      step.resolu = `${cible} = ${resolu}`;
      const valeur = evalArith(resolu, ctx);
      if (cible.startsWith("R")) {
        registres[cible] = valeur;
      } else {
        sorties[cible as "MT" | "NB" | "TY" | "BASE"] = valeur;
      }
      step.affectation = { cible, valeur };
      if (missing.length) {
        step.erreur = `Accesseurs non fournis (=0) : ${missing.join(", ")}`;
      }
      trace.push(step);
      i++;
      continue;
    }

    // Instruction non reconnue
    step.resolu = l.instruction;
    step.erreur = "Instruction non reconnue par le simulateur";
    trace.push(step);
    i++;
  }

  return { ok: true, registres, sorties, trace, finExplicite };
}