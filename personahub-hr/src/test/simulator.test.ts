import { describe, it, expect } from "vitest";
import { simulateRegle, parseInstructionLine } from "@/pages/paie/regles/engine/simulator";
import type { SimulationContext } from "@/pages/paie/regles/engine/simulator";

// ─── Contexte de base pour les tests ─────────────────────────────────────────
const ctxBase: SimulationContext = {
  rubriques: {
    MT:  { SALBASE: 10000, HSUPP: 500 },
    NB:  { HSUPP: 10, JOURTRAV: 26 },
    TY:  { CONTRAT: 1 },
    MTP: { SALBASE: 9000 },
  },
  baremes: {
    IGR: [
      { cle: 0,     valeur: 0   },
      { cle: 30001, valeur: 10  },
      { cle: 50001, valeur: 20  },
      { cle: 80001, valeur: 30  },
    ],
  },
};

// ─── parseInstructionLine ─────────────────────────────────────────────────────
describe("parseInstructionLine", () => {
  it("extrait le numéro et le corps", () => {
    const r = parseInstructionLine("10 R01 = MT.SALBASE", 1);
    expect(r.numero).toBe(10);
    expect(r.instruction).toBe("R01 = MT.SALBASE");
  });

  it("ignore les commentaires après ;", () => {
    const r = parseInstructionLine("20 MT = R01 * 2 ; cotisation", 2);
    expect(r.instruction).toBe("MT = R01 * 2");
  });

  it("détecte un label (:FIN)", () => {
    const r = parseInstructionLine("30 BRANCH FIN :FIN", 3);
    expect(r.label).toBe("FIN");
  });

  it("utilise le fallbackNum si pas de numéro", () => {
    const r = parseInstructionLine("R01 = 100", 5);
    expect(r.numero).toBe(5);
  });
});

// ─── simulateRegle — affectations simples ─────────────────────────────────────
describe("simulateRegle — affectations", () => {
  it("résout un accesseur MT.SALBASE → registre R01", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "R01 = MT.SALBASE" }],
      ctxBase
    );
    expect(result.ok).toBe(true);
    expect(result.registres["R01"]).toBe(10000);
  });

  it("calcule MT = R01 * 0.10 (cotisation 10%)", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "R01 = MT.SALBASE" },
        { numero: 20, instruction: "MT = R01 * 0.10" },
      ],
      ctxBase
    );
    expect(result.sorties.MT).toBe(1000);
  });

  it("affecte directement la sortie NB", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "NB = NB.HSUPP" }],
      ctxBase
    );
    expect(result.sorties.NB).toBe(10);
  });
});

// ─── simulateRegle — branchements ─────────────────────────────────────────────
describe("simulateRegle — branchements conditionnels", () => {
  it("SI condition vraie → BRANCH pris, saute une instruction", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "R01 = MT.SALBASE" },
        { numero: 20, instruction: "SI R01 > 5000 BRANCH FIN" },
        { numero: 30, instruction: "MT = 0" },         // ne doit pas s'exécuter
        { numero: 40, instruction: "FIN", label: "FIN" },
      ],
      ctxBase
    );
    // MT ne doit pas être 0 (step 30 sauté)
    expect(result.sorties.MT).toBeUndefined();
    expect(result.finExplicite).toBe(true);
  });

  it("SI condition fausse → BRANCH non pris, continue", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "R01 = 100" },
        { numero: 20, instruction: "SI R01 > 5000 BRANCH SAUT" },
        { numero: 30, instruction: "MT = 999" },       // doit s'exécuter
        { numero: 40, instruction: "FIN" },
        { numero: 50, instruction: "MT = 0", label: "SAUT" },
      ],
      ctxBase
    );
    expect(result.sorties.MT).toBe(999);
  });
});

// ─── simulateRegle — barème @TAB ──────────────────────────────────────────────
describe("simulateRegle — @TAB barème", () => {
  it("lookup barème IGR pour une valeur dans la tranche 30001-50000", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "R01 = 40000" },
        { numero: 20, instruction: "MT = R01 @TAB IGR" },
      ],
      ctxBase
    );
    expect(result.sorties.MT).toBe(10); // tranche à 10%
  });

  it("lookup barème IGR pour 0 → valeur 0", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "MT = 0 @TAB IGR" }],
      ctxBase
    );
    expect(result.sorties.MT).toBe(0);
  });
});

// ─── simulateRegle — @MIN / @MAX ──────────────────────────────────────────────
describe("simulateRegle — @MIN / @MAX", () => {
  it("@MIN retourne le minimum", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "MT = 5000 @MIN 3000" }],
      ctxBase
    );
    expect(result.sorties.MT).toBe(3000);
  });

  it("@MAX retourne le maximum", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "MT = 5000 @MAX 8000" }],
      ctxBase
    );
    expect(result.sorties.MT).toBe(8000);
  });
});

// ─── simulateRegle — FIN explicite ────────────────────────────────────────────
describe("simulateRegle — arrêt explicite", () => {
  it("FIN arrête l'exécution", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "MT = 500" },
        { numero: 20, instruction: "FIN" },
        { numero: 30, instruction: "MT = 9999" }, // ne doit jamais s'exécuter
      ],
      ctxBase
    );
    expect(result.sorties.MT).toBe(500);
    expect(result.finExplicite).toBe(true);
  });
});

// ─── simulateRegle — sécurité ──────────────────────────────────────────────────
describe("simulateRegle — sécurité", () => {
  it("une expression avec du code arbitraire renvoie 0 sans planter", () => {
    const result = simulateRegle(
      [{ numero: 10, instruction: "MT = alert(1)" }],
      ctxBase
    );
    // L'expression non numérique doit être ignorée → MT non défini ou 0
    expect(result.sorties.MT === undefined || result.sorties.MT === 0).toBe(true);
  });

  it("détecte une boucle infinie (>1000 itérations)", () => {
    const result = simulateRegle(
      [
        { numero: 10, instruction: "R01 = 1", label: "BOUCLE" },
        { numero: 20, instruction: "BRANCH BOUCLE" },
      ],
      ctxBase
    );
    expect(result.ok).toBe(false);
    expect(result.erreurGlobale).toMatch(/1000/);
  });
});
