"""
import_ref_from_supabase.py
Importe toutes les tables ref_ depuis Supabase vers PostgreSQL local.
Utilise la REST API de Supabase (pas besoin de connexion directe).
Lancer depuis n'importe quel dossier.
"""

import urllib.request
import urllib.error
import json
import psycopg2
import sys

# ─── Configuration Supabase ───────────────────────────────────────────────────
SUPABASE_URL = "https://wozlylbwjeewukdlnmtk.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvemx5bGJ3amVld3VrZGxubXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMTI4NjEsImV4cCI6MjA4ODg4ODg2MX0.6KDUsS4uLE3UjXk8QDVJ1t686vCXi4oLwKd5BiRPx5k"

# ─── Configuration PostgreSQL local ──────────────────────────────────────────
PG_CONFIG = {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "solgeis_hr",
    "user": "postgres",
    "password": "Solgeis2025",
}

# Tables à importer (toutes les ref_)
REF_TABLES = [
    "ref_activite", "ref_avantage", "ref_banque", "ref_categorie_emploi",
    "ref_categorie_professionnelle", "ref_classe", "ref_classification",
    "ref_coefficient", "ref_college", "ref_commune", "ref_competence",
    "ref_constante_paie", "ref_convention_collective", "ref_departement",
    "ref_devise", "ref_domaine_formation", "ref_echelle", "ref_echelon",
    "ref_emploi", "ref_evenement_ferie", "ref_famille_conge",
    "ref_famille_ferie", "ref_famille_metier", "ref_famille_rubrique_paie",
    "ref_filiere", "ref_filiere_diplome", "ref_flux_rubrique_paie",
    "ref_fonction", "ref_frequence_paie_calendrier", "ref_frequence_rubrique_paie",
    "ref_genre", "ref_grade", "ref_grade_mandat", "ref_imputation_comptable",
    "ref_jours_feries", "ref_lien_parente", "ref_mandat_type", "ref_metier",
    "ref_mode_paiement", "ref_motif_absence", "ref_motif_affectation",
    "ref_motif_classification", "ref_motif_depart_provisoire",
    "ref_motif_evolution", "ref_motif_recrutement", "ref_motif_rupture",
    "ref_motif_sortie", "ref_nationalite", "ref_niveau_competence",
    "ref_niveau_diplome", "ref_niveau_qualification", "ref_organisme_formation",
    "ref_organisme_social", "ref_pays", "ref_poste", "ref_poste_instances",
    "ref_priorite", "ref_qualification", "ref_region",
    "ref_regle_calcul_standard", "ref_responsabilite", "ref_rubrique_paie",
    "ref_secteur_activite", "ref_situation_familiale", "ref_source_recrutement",
    "ref_specialite_diplome", "ref_statut", "ref_statut_cnss",
    "ref_statut_contrat", "ref_syndicat", "ref_taux_cotisation",
    "ref_type_absence", "ref_type_affiliation", "ref_type_competence",
    "ref_type_conge", "ref_type_conge_histo", "ref_type_contrat",
    "ref_type_diplome", "ref_type_document", "ref_type_etablissement",
    "ref_type_formation", "ref_type_handicap", "ref_type_jour",
    "ref_type_mouvement", "ref_type_remuneration", "ref_type_rubrique_paie",
    "ref_type_temps", "ref_type_uo", "ref_unite_duree_contrat", "ref_ville",
]


def fetch_from_supabase(table: str) -> list:
    """Récupère toutes les données d'une table Supabase via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*&limit=10000"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, list) else []
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []  # Table n'existe pas dans Supabase
        raise
    except Exception as e:
        print(f"    Erreur Supabase {table}: {e}")
        return []


def table_exists_in_pg(cursor, table: str) -> bool:
    cursor.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=%s)",
        (table,)
    )
    return cursor.fetchone()[0]


def upsert_to_pg(cursor, table: str, rows: list) -> int:
    """Insère les données dans PostgreSQL avec ON CONFLICT DO NOTHING."""
    if not rows:
        return 0

    # Colonnes depuis le premier enregistrement
    cols = list(rows[0].keys())
    if not cols:
        return 0

    cols_str = ", ".join([f'"{c}"' for c in cols])
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f'INSERT INTO "{table}" ({cols_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    count = 0
    for row in rows:
        values = [row.get(c) for c in cols]
        try:
            cursor.execute(sql, values)
            count += cursor.rowcount
        except Exception as e:
            # Ignorer les erreurs sur les lignes individuelles
            pass

    return count


def main():
    print("=" * 60)
    print("Import des données de référence Supabase → PostgreSQL")
    print("=" * 60)

    # Connexion PostgreSQL
    try:
        conn = psycopg2.connect(**PG_CONFIG)
        conn.autocommit = False
        cursor = conn.cursor()
        print("OK : Connexion PostgreSQL etablie\n")
    except Exception as e:
        print(f"ERREUR connexion PostgreSQL : {e}")
        sys.exit(1)

    total_imported = 0
    tables_ok = 0
    tables_vides = 0
    tables_erreur = 0

    for table in REF_TABLES:
        sys.stdout.write(f"  {table}... ")
        sys.stdout.flush()

        # Vérifier que la table existe dans PostgreSQL local
        if not table_exists_in_pg(cursor, table):
            print("ignoree (non existante en local)")
            continue

        # Récupérer depuis Supabase
        try:
            rows = fetch_from_supabase(table)
        except Exception as e:
            print(f"ERREUR: {e}")
            tables_erreur += 1
            continue

        if not rows:
            print("vide dans Supabase")
            tables_vides += 1
            continue

        # Insérer dans PostgreSQL
        try:
            count = upsert_to_pg(cursor, table, rows)
            conn.commit()
            print(f"{count} lignes importees (/{len(rows)} total)")
            total_imported += count
            tables_ok += 1
        except Exception as e:
            conn.rollback()
            print(f"ERREUR insertion: {e}")
            tables_erreur += 1

    cursor.close()
    conn.close()

    print("\n" + "=" * 60)
    print(f"Tables importees avec succes : {tables_ok}")
    print(f"Tables vides dans Supabase   : {tables_vides}")
    print(f"Tables en erreur             : {tables_erreur}")
    print(f"Total lignes importees       : {total_imported}")
    print("=" * 60)
    print("\nActualisez le navigateur (F5) et reessayez de creer une societe !")


if __name__ == "__main__":
    main()
