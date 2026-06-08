"""
reactiver_supabase.py
─────────────────────
Réactive automatiquement les appels Supabase désactivés du type :
    const data = []; const error = null; // Supabase desactive

Stratégie :
  1. Pour CHAQUE occurrence, on remonte dans le code pour trouver le pattern juste avant :
       - `const { data: X, error: Y } = await supabase.from(...)...` qui aurait été commenté
       - OU une variable utilisée ensuite (collab, ancienCollab, etc.) → on devine la table
  2. On RÉTABLIT l'appel Supabase d'origine quand c'est évident.
  3. Pour les cas ambigus, on les LISTE pour intervention manuelle.

Usage :
    cd D:\\SOLGEIS\\personahub-hr
    python reactiver_supabase.py [--dry-run]

Options :
    --dry-run : liste seulement, ne modifie aucun fichier
    --apply   : applique les corrections automatiques détectées
"""

import os
import re
import sys
import io
from pathlib import Path

# Force UTF-8 output for Windows PowerShell
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SRC_DIR = Path("src")
PATTERN_DESACTIVE = re.compile(
    r"^(\s*)const\s+data\s*=\s*\[\];\s*const\s+error\s*=\s*null;\s*//\s*Supabase\s+desactive\s*$",
    re.MULTILINE,
)

DRY_RUN = "--dry-run" in sys.argv or "--apply" not in sys.argv

# ──────────────────────────────────────────────────────────────────────
# Heuristiques de réparation : on regarde le contexte (lignes avant/après)
# pour deviner quelle requête Supabase était à l'origine.
# ──────────────────────────────────────────────────────────────────────

# Cas typiques détectés dans le projet PersonaHub :
KNOWN_CASES = [
    {
        "name": "Recherche collab par ancien_matricule",
        "context_after": [r"if\s*\(\s*ancienCollab\s*\)", r"ancienCollab\."],
        "replacement": (
            "{indent}const { data: ancienCollab } = await supabase\n"
            "{indent}  .from(\"collaborateurs\")\n"
            "{indent}  .select(\"id, matricule\")\n"
            "{indent}  .eq(\"matricule\", ancienMatricule)\n"
            "{indent}  .maybeSingle();"
        ),
    },
    {
        "name": "Recherche contrats d'un ancien collab",
        "context_after": [r"if\s*\(\s*ancienContrats", r"ancienContrats\."],
        "replacement": (
            "{indent}const { data: ancienContrats } = await supabase\n"
            "{indent}  .from(\"collaborateur_contrats\")\n"
            "{indent}  .select(\"*\")\n"
            "{indent}  .eq(\"collaborateur_id\", (ancienCollab as any).id)\n"
            "{indent}  .eq(\"archive\", false);"
        ),
    },
    {
        "name": "Recherche affectations d'un ancien collab",
        "context_after": [r"if\s*\(\s*ancienAff", r"ancienAff\."],
        "replacement": (
            "{indent}const { data: ancienAff } = await supabase\n"
            "{indent}  .from(\"collaborateur_affectations\")\n"
            "{indent}  .select(\"*\")\n"
            "{indent}  .eq(\"collaborateur_id\", (ancienCollab as any).id)\n"
            "{indent}  .eq(\"archive\", false);"
        ),
    },
    {
        "name": "Récup contrats actifs (RG-CTR-01 exclusivité)",
        "context_after": [r"contratsEnCours"],
        "replacement": (
            "{indent}const { data: contratsEnCours } = await supabase\n"
            "{indent}  .from(\"collaborateur_contrats\")\n"
            "{indent}  .select(\"id\")\n"
            "{indent}  .eq(\"collaborateur_id\", collaborateurId)\n"
            "{indent}  .eq(\"archive\", false)\n"
            "{indent}  .in(\"code_statut_contrat\", [\"ACTIF\", \"EN_COURS\"]);"
        ),
    },
    {
        "name": "Récup autres contrats actifs (RG-CTR-02 sync statut)",
        "context_after": [r"autresActifs"],
        "replacement": (
            "{indent}const { data: autresActifs } = await supabase\n"
            "{indent}  .from(\"collaborateur_contrats\")\n"
            "{indent}  .select(\"id\")\n"
            "{indent}  .eq(\"collaborateur_id\", collaborateurId)\n"
            "{indent}  .eq(\"archive\", false)\n"
            "{indent}  .in(\"code_statut_contrat\", [\"ACTIF\", \"EN_COURS\"])\n"
            "{indent}  .neq(\"id\", contrat?.id || \"\");"
        ),
    },
    {
        "name": "Récup affectations actives à clôturer",
        "context_after": [r"affActives", r"listeAffActives"],
        "replacement": (
            "{indent}const { data: affActives, error: errFetch } = await supabase\n"
            "{indent}  .from(\"collaborateur_affectations\")\n"
            "{indent}  .select(\"id, code_poste, date_fin_poste\")\n"
            "{indent}  .eq(\"collaborateur_id\", collaborateurId)\n"
            "{indent}  .eq(\"archive\", false)\n"
            "{indent}  .is(\"date_fin_uo\", null);"
        ),
    },
    {
        "name": "Récup collaborateur par ID (responsable poste)",
        "context_after": [r"if\s*\(\s*collab\s*\)", r"collab\."],
        "replacement": (
            "{indent}const { data: collab } = await supabase\n"
            "{indent}  .from(\"collaborateurs\")\n"
            "{indent}  .select(\"id, matricule, nom, prenom\")\n"
            "{indent}  .eq(\"id\", (data as any).collaborateur_id)\n"
            "{indent}  .maybeSingle();"
        ),
    },
    {
        "name": "Récup qualifications d'un collab",
        "context_after": [r"collabQualifs"],
        "replacement": (
            "{indent}const { data: collabQualifs } = await supabase\n"
            "{indent}  .from(\"collaborateur_qualifications\")\n"
            "{indent}  .select(\"id\")\n"
            "{indent}  .eq(\"collaborateur_id\", collaborateurId);"
        ),
    },
    {
        "name": "Recherche collaborateurs (autocomplete)",
        "context_after": [r"setResponsableSuggestions", r"setManagerN1Suggestions", r"setManagerN2Suggestions"],
        "replacement": (
            "{indent}// NOTE: utilise la variable de recherche locale (responsableSearch / managerN1Search / managerN2Search)\n"
            "{indent}const { data } = await supabase\n"
            "{indent}  .from(\"collaborateurs\")\n"
            "{indent}  .select(\"id, matricule, nom, prenom\")\n"
            "{indent}  .eq(\"archive\", false)\n"
            "{indent}  .limit(10);"
        ),
    },
    {
        "name": "Récup type_uo niveaux",
        "context_after": [r"\(\s*types\s+as\s+any"],
        "replacement": (
            "{indent}const { data: types } = await supabase\n"
            "{indent}  .from(\"ref_type_uo\")\n"
            "{indent}  .select(\"code, niveau\")\n"
            "{indent}  .in(\"code\", typeCodes);"
        ),
    },
    {
        "name": "Récup divers d'un collab",
        "context_after": [r"if\s*\(\s*data\s*\)", r"setDivers\(data\)"],
        "replacement": (
            "{indent}const { data } = await supabase\n"
            "{indent}  .from(\"collaborateur_divers\")\n"
            "{indent}  .select(\"*\")\n"
            "{indent}  .eq(\"collaborateur_id\", collaborateurId)\n"
            "{indent}  .maybeSingle();"
        ),
    },
    {
        "name": "Liste référentiel générique (RefSelect/RefSelectCreatable)",
        "context_after": [r"setOptions"],
        "replacement": (
            "{indent}const { data } = await supabase\n"
            "{indent}  .from(table as never)\n"
            "{indent}  .select(`${valueCol}, ${labelCol}` as never);"
        ),
    },
]

# ──────────────────────────────────────────────────────────────────────

def lines_around(content: str, position: int, before: int = 5, after: int = 8) -> str:
    """Retourne les lignes autour d'une position dans le texte."""
    lines = content.split("\n")
    line_no = content[:position].count("\n")
    start = max(0, line_no - before)
    end = min(len(lines), line_no + after + 1)
    snippet = []
    for i in range(start, end):
        marker = " ▶ " if i == line_no else "   "
        snippet.append(f"{i+1:4d}{marker}{lines[i]}")
    return "\n".join(snippet)


def detect_case(content: str, position: int) -> dict | None:
    """Cherche dans les ~10 lignes suivantes si un pattern connu correspond."""
    lines = content[position:].split("\n")[:12]
    snippet = "\n".join(lines)
    for case in KNOWN_CASES:
        for pat in case["context_after"]:
            if re.search(pat, snippet):
                return case
    return None


def process_file(path: Path, apply: bool) -> tuple[int, int, list]:
    """Retourne (nb_auto_corriges, nb_ambigus, liste_ambigus)"""
    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        print(f"  ERREUR lecture {path}: {e}")
        return 0, 0, []

    matches = list(PATTERN_DESACTIVE.finditer(content))
    if not matches:
        return 0, 0, []

    # On itère depuis la fin pour préserver les positions
    auto_count = 0
    ambig = []
    new_content = content
    for m in reversed(matches):
        indent = m.group(1)
        case = detect_case(content, m.end())
        if case:
            replacement = render_replacement(case["replacement"], indent)
            new_content = new_content[:m.start()] + replacement + new_content[m.end():]
            auto_count += 1
        else:
            ambig.append({
                "line": content[:m.start()].count("\n") + 1,
                "context": lines_around(content, m.start()),
            })

    if apply and auto_count > 0:
        path.write_text(new_content, encoding="utf-8")

    return auto_count, len(ambig), ambig


def render_replacement(template: str, indent: str) -> str:
    """
    Remplace uniquement {indent} dans le template, sans utiliser str.format()
    qui se confond avec les accolades TypeScript ({ data }, ${var}, etc.)
    """
    return template.replace("{indent}", indent)


def main():
    if not SRC_DIR.exists():
        print(f"ERREUR: dossier '{SRC_DIR}' introuvable.")
        print("Lance ce script depuis la racine du projet (D:\\SOLGEIS\\personahub-hr)")
        sys.exit(1)

    apply_changes = "--apply" in sys.argv
    mode = "APPLY (modifications réelles)" if apply_changes else "DRY-RUN (aucune modification)"
    print(f"Mode : {mode}\n")

    total_auto = 0
    total_ambig = 0
    all_ambigs = []

    for path in sorted(SRC_DIR.rglob("*")):
        if path.suffix not in {".tsx", ".ts"}:
            continue
        if "node_modules" in path.parts:
            continue
        auto, nb_ambig, ambigs = process_file(path, apply_changes)
        if auto + nb_ambig > 0:
            print(f"  {path}")
            print(f"    Auto-corrigés : {auto}   Ambigus : {nb_ambig}")
            total_auto += auto
            total_ambig += nb_ambig
            for a in ambigs:
                all_ambigs.append({"file": path, **a})

    print("\n" + "=" * 70)
    print(f"TOTAL Auto-corrigés : {total_auto}")
    print(f"TOTAL Ambigus       : {total_ambig}")
    print("=" * 70)

    if all_ambigs:
        print("\n[!] LISTE DES CAS AMBIGUS A CORRIGER MANUELLEMENT :\n")
        for a in all_ambigs:
            print(f"\n[FICHIER] {a['file']} (ligne {a['line']})")
            print("-" * 60)
            print(a["context"])

    if not apply_changes and total_auto > 0:
        print(f"\n[i] Pour appliquer les {total_auto} corrections automatiques :")
        print("    python reactiver_supabase.py --apply")


if __name__ == "__main__":
    main()
