export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      bareme: {
        Row: {
          actif: boolean
          archive: boolean
          code: string
          created_at: string
          created_by: string | null
          date_debut_validite: string | null
          date_fin_validite: string | null
          decision_reference: string | null
          description: string | null
          id: string
          libelle: string
          type_cle: string
          type_valeur: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actif?: boolean
          archive?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          date_debut_validite?: string | null
          date_fin_validite?: string | null
          decision_reference?: string | null
          description?: string | null
          id?: string
          libelle: string
          type_cle: string
          type_valeur: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actif?: boolean
          archive?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          date_debut_validite?: string | null
          date_fin_validite?: string | null
          decision_reference?: string | null
          description?: string | null
          id?: string
          libelle?: string
          type_cle?: string
          type_valeur?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      bareme_ligne: {
        Row: {
          bareme_id: string
          cle: string
          commentaire: string | null
          created_at: string
          id: string
          ordre: number
          updated_at: string
          valeur: number | null
          valeur_texte: string | null
        }
        Insert: {
          bareme_id: string
          cle: string
          commentaire?: string | null
          created_at?: string
          id?: string
          ordre?: number
          updated_at?: string
          valeur?: number | null
          valeur_texte?: string | null
        }
        Update: {
          bareme_id?: string
          cle?: string
          commentaire?: string | null
          created_at?: string
          id?: string
          ordre?: number
          updated_at?: string
          valeur?: number | null
          valeur_texte?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bareme_ligne_bareme_id_fkey"
            columns: ["bareme_id"]
            isOneToOne: false
            referencedRelation: "bareme"
            referencedColumns: ["id"]
          },
        ]
      }
      calendrier_paie: {
        Row: {
          annee: number
          created_at: string
          date_debut: string
          date_fin: string
          date_limite_saisie: string | null
          date_limite_validation: string | null
          date_reference: string
          est_fin_annee: boolean
          est_fin_mois: boolean
          est_fin_semestre: boolean
          est_fin_trimestre: boolean
          id: string
          mois: number
          numero_periode: number
          observations: string | null
          plan_paie_id: string
          statut: string
          type_periode: string
          updated_at: string
        }
        Insert: {
          annee: number
          created_at?: string
          date_debut: string
          date_fin: string
          date_limite_saisie?: string | null
          date_limite_validation?: string | null
          date_reference: string
          est_fin_annee?: boolean
          est_fin_mois?: boolean
          est_fin_semestre?: boolean
          est_fin_trimestre?: boolean
          id?: string
          mois: number
          numero_periode: number
          observations?: string | null
          plan_paie_id: string
          statut?: string
          type_periode?: string
          updated_at?: string
        }
        Update: {
          annee?: number
          created_at?: string
          date_debut?: string
          date_fin?: string
          date_limite_saisie?: string | null
          date_limite_validation?: string | null
          date_reference?: string
          est_fin_annee?: boolean
          est_fin_mois?: boolean
          est_fin_semestre?: boolean
          est_fin_trimestre?: boolean
          id?: string
          mois?: number
          numero_periode?: number
          observations?: string | null
          plan_paie_id?: string
          statut?: string
          type_periode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendrier_paie_plan_paie_id_fkey"
            columns: ["plan_paie_id"]
            isOneToOne: false
            referencedRelation: "plan_paie"
            referencedColumns: ["id"]
          },
        ]
      }
      cnss_declaration_lignes: {
        Row: {
          cin: string | null
          collaborateur_id: string | null
          created_at: string
          declaration_id: string
          erreurs: Json | null
          est_valide: boolean | null
          id: string
          matricule: string | null
          nom: string
          nombre_jours: number | null
          num_cnss: string | null
          observations: string | null
          prenom: string
          salaire_brut: number | null
          statut_salarie: string
          updated_at: string
        }
        Insert: {
          cin?: string | null
          collaborateur_id?: string | null
          created_at?: string
          declaration_id: string
          erreurs?: Json | null
          est_valide?: boolean | null
          id?: string
          matricule?: string | null
          nom: string
          nombre_jours?: number | null
          num_cnss?: string | null
          observations?: string | null
          prenom: string
          salaire_brut?: number | null
          statut_salarie?: string
          updated_at?: string
        }
        Update: {
          cin?: string | null
          collaborateur_id?: string | null
          created_at?: string
          declaration_id?: string
          erreurs?: Json | null
          est_valide?: boolean | null
          id?: string
          matricule?: string | null
          nom?: string
          nombre_jours?: number | null
          num_cnss?: string | null
          observations?: string | null
          prenom?: string
          salaire_brut?: number | null
          statut_salarie?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cnss_declaration_lignes_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cnss_declaration_lignes_declaration_id_fkey"
            columns: ["declaration_id"]
            isOneToOne: false
            referencedRelation: "cnss_declarations"
            referencedColumns: ["id"]
          },
        ]
      }
      cnss_declarations: {
        Row: {
          annee: number
          created_at: string
          created_by: string | null
          fichier_preetabli_path: string | null
          fichier_xml_path: string | null
          id: string
          mois: number
          nombre_lignes: number | null
          statut: string
          total_jours: number | null
          total_salaires: number | null
          updated_at: string
        }
        Insert: {
          annee: number
          created_at?: string
          created_by?: string | null
          fichier_preetabli_path?: string | null
          fichier_xml_path?: string | null
          id?: string
          mois: number
          nombre_lignes?: number | null
          statut?: string
          total_jours?: number | null
          total_salaires?: number | null
          updated_at?: string
        }
        Update: {
          annee?: number
          created_at?: string
          created_by?: string | null
          fichier_preetabli_path?: string | null
          fichier_xml_path?: string | null
          id?: string
          mois?: number
          nombre_lignes?: number | null
          statut?: string
          total_jours?: number | null
          total_salaires?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      collaborateur_adresses: {
        Row: {
          adresse: string
          archive: boolean
          code_pays: string | null
          code_postal: string | null
          code_region: string | null
          code_ville: string | null
          collaborateur_id: string
          complement_adresse: string | null
          created_at: string
          email: string | null
          id: string
          is_adresse_correspondance: boolean
          is_adresse_principale: boolean
          is_adresse_professionnelle: boolean
          is_adresse_residence: boolean
          telephone: string | null
          telephone_bis: string | null
          updated_at: string
        }
        Insert: {
          adresse: string
          archive?: boolean
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_ville?: string | null
          collaborateur_id: string
          complement_adresse?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_adresse_correspondance?: boolean
          is_adresse_principale?: boolean
          is_adresse_professionnelle?: boolean
          is_adresse_residence?: boolean
          telephone?: string | null
          telephone_bis?: string | null
          updated_at?: string
        }
        Update: {
          adresse?: string
          archive?: boolean
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_ville?: string | null
          collaborateur_id?: string
          complement_adresse?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_adresse_correspondance?: boolean
          is_adresse_principale?: boolean
          is_adresse_professionnelle?: boolean
          is_adresse_residence?: boolean
          telephone?: string | null
          telephone_bis?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_adresses_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_affectations: {
        Row: {
          archive: boolean
          code_poste: string | null
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          date_debut_poste: string | null
          date_debut_uo: string
          date_fin_poste: string | null
          date_fin_uo: string | null
          forcage_manager: boolean
          id: string
          manager_n1_id: string | null
          manager_n2_id: string | null
          motif_affectation: string | null
          responsable_id: string | null
          unite_id: string | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_poste?: string | null
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          date_debut_poste?: string | null
          date_debut_uo: string
          date_fin_poste?: string | null
          date_fin_uo?: string | null
          forcage_manager?: boolean
          id?: string
          manager_n1_id?: string | null
          manager_n2_id?: string | null
          motif_affectation?: string | null
          responsable_id?: string | null
          unite_id?: string | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_poste?: string | null
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          date_debut_poste?: string | null
          date_debut_uo?: string
          date_fin_poste?: string | null
          date_fin_uo?: string | null
          forcage_manager?: boolean
          id?: string
          manager_n1_id?: string | null
          manager_n2_id?: string | null
          motif_affectation?: string | null
          responsable_id?: string | null
          unite_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_affectations_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_affectations_manager_n1_id_fkey"
            columns: ["manager_n1_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_affectations_manager_n2_id_fkey"
            columns: ["manager_n2_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_affectations_unite_id_fkey"
            columns: ["unite_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_avantages: {
        Row: {
          archive: boolean
          code_avantage: string
          collaborateur_id: string
          created_at: string
          date_debut: string | null
          date_fin: string | null
          est_brut: boolean
          id: string
          updated_at: string
          valeur_monetaire: number | null
          valeur_nature: string | null
        }
        Insert: {
          archive?: boolean
          code_avantage: string
          collaborateur_id: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          est_brut?: boolean
          id?: string
          updated_at?: string
          valeur_monetaire?: number | null
          valeur_nature?: string | null
        }
        Update: {
          archive?: boolean
          code_avantage?: string
          collaborateur_id?: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          est_brut?: boolean
          id?: string
          updated_at?: string
          valeur_monetaire?: number | null
          valeur_nature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_avantages_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_competences: {
        Row: {
          archive: boolean
          code_competence: string
          code_niveau: string
          collaborateur_id: string
          created_at: string
          date_evaluation: string | null
          id: string
          source_evaluation: string | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_competence: string
          code_niveau: string
          collaborateur_id: string
          created_at?: string
          date_evaluation?: string | null
          id?: string
          source_evaluation?: string | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_competence?: string
          code_niveau?: string
          collaborateur_id?: string
          created_at?: string
          date_evaluation?: string | null
          id?: string
          source_evaluation?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_competences_code_competence_fkey"
            columns: ["code_competence"]
            isOneToOne: false
            referencedRelation: "ref_competence"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_competences_code_niveau_fkey"
            columns: ["code_niveau"]
            isOneToOne: false
            referencedRelation: "ref_niveau_competence"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_competences_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_conjoints: {
        Row: {
          archive: boolean
          cin: string | null
          cin_date_debut: string | null
          cin_date_fin: string | null
          code_genre: string
          code_nationalite: string | null
          code_statut: string
          collaborateur_id: string
          created_at: string
          date_deces: string | null
          date_fin_relation: string | null
          date_mariage: string | null
          date_naissance: string | null
          est_salarie: boolean
          id: string
          lieu_mariage: string | null
          lieu_naissance: string | null
          matricule_conjoint: string | null
          nom: string
          observations: string | null
          passeport: string | null
          passeport_date_debut: string | null
          passeport_date_fin: string | null
          prenom: string
          reference_decision: string | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          cin?: string | null
          cin_date_debut?: string | null
          cin_date_fin?: string | null
          code_genre?: string
          code_nationalite?: string | null
          code_statut?: string
          collaborateur_id: string
          created_at?: string
          date_deces?: string | null
          date_fin_relation?: string | null
          date_mariage?: string | null
          date_naissance?: string | null
          est_salarie?: boolean
          id?: string
          lieu_mariage?: string | null
          lieu_naissance?: string | null
          matricule_conjoint?: string | null
          nom: string
          observations?: string | null
          passeport?: string | null
          passeport_date_debut?: string | null
          passeport_date_fin?: string | null
          prenom: string
          reference_decision?: string | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          cin?: string | null
          cin_date_debut?: string | null
          cin_date_fin?: string | null
          code_genre?: string
          code_nationalite?: string | null
          code_statut?: string
          collaborateur_id?: string
          created_at?: string
          date_deces?: string | null
          date_fin_relation?: string | null
          date_mariage?: string | null
          date_naissance?: string | null
          est_salarie?: boolean
          id?: string
          lieu_mariage?: string | null
          lieu_naissance?: string | null
          matricule_conjoint?: string | null
          nom?: string
          observations?: string | null
          passeport?: string | null
          passeport_date_debut?: string | null
          passeport_date_fin?: string | null
          prenom?: string
          reference_decision?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_conjoints_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_contacts: {
        Row: {
          adresse: string | null
          archive: boolean
          code_lien: string
          collaborateur_id: string
          created_at: string
          est_principal: boolean
          est_urgence: boolean
          id: string
          mail: string | null
          mobile: string | null
          nom_contact: string | null
          observations: string | null
          telephone: string | null
          updated_at: string
        }
        Insert: {
          adresse?: string | null
          archive?: boolean
          code_lien: string
          collaborateur_id: string
          created_at?: string
          est_principal?: boolean
          est_urgence?: boolean
          id?: string
          mail?: string | null
          mobile?: string | null
          nom_contact?: string | null
          observations?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          adresse?: string | null
          archive?: boolean
          code_lien?: string
          collaborateur_id?: string
          created_at?: string
          est_principal?: boolean
          est_urgence?: boolean
          id?: string
          mail?: string | null
          mobile?: string | null
          nom_contact?: string | null
          observations?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_contacts_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_contrats: {
        Row: {
          archive: boolean
          code_devise: string | null
          code_motif_recrutement: string | null
          code_source_recrutement: string | null
          code_statut_contrat: string
          code_temps: string | null
          code_type_contrat: string
          code_unite_duree: string | null
          collaborateur_id: string
          commentaire_sortie: string | null
          created_at: string
          date_debut: string
          date_depart_previsionnelle: string | null
          date_fin: string | null
          date_sortie: string | null
          date_titularisation: string | null
          duree_contrat: number | null
          id: string
          motif_sortie: string | null
          reference_contrat: string | null
          reference_decision_recrutement: string | null
          responsable_recrutement: string | null
          societe_id: string | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_devise?: string | null
          code_motif_recrutement?: string | null
          code_source_recrutement?: string | null
          code_statut_contrat?: string
          code_temps?: string | null
          code_type_contrat: string
          code_unite_duree?: string | null
          collaborateur_id: string
          commentaire_sortie?: string | null
          created_at?: string
          date_debut: string
          date_depart_previsionnelle?: string | null
          date_fin?: string | null
          date_sortie?: string | null
          date_titularisation?: string | null
          duree_contrat?: number | null
          id?: string
          motif_sortie?: string | null
          reference_contrat?: string | null
          reference_decision_recrutement?: string | null
          responsable_recrutement?: string | null
          societe_id?: string | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_devise?: string | null
          code_motif_recrutement?: string | null
          code_source_recrutement?: string | null
          code_statut_contrat?: string
          code_temps?: string | null
          code_type_contrat?: string
          code_unite_duree?: string | null
          collaborateur_id?: string
          commentaire_sortie?: string | null
          created_at?: string
          date_debut?: string
          date_depart_previsionnelle?: string | null
          date_fin?: string | null
          date_sortie?: string | null
          date_titularisation?: string | null
          duree_contrat?: number | null
          id?: string
          motif_sortie?: string | null
          reference_contrat?: string | null
          reference_decision_recrutement?: string | null
          responsable_recrutement?: string | null
          societe_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_contrats_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_contrats_societe_id_fkey"
            columns: ["societe_id"]
            isOneToOne: false
            referencedRelation: "societes"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_departs: {
        Row: {
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          created_by: string | null
          date_depart: string
          id: string
          motif_depart: string
          reference_decision: string | null
          statut: string
          traite_le: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_depart: string
          id?: string
          motif_depart: string
          reference_decision?: string | null
          statut?: string
          traite_le?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_depart?: string
          id?: string
          motif_depart?: string
          reference_decision?: string | null
          statut?: string
          traite_le?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_departs_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_departs_provisoires: {
        Row: {
          archive: boolean
          code_motif: string
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          created_by: string | null
          date_debut: string
          date_decision: string | null
          date_fin_effective: string | null
          date_fin_prevue: string
          depart_original_id: string | null
          id: string
          numero_reconduction: number
          reference_decision: string | null
          statut: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archive?: boolean
          code_motif: string
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_debut: string
          date_decision?: string | null
          date_fin_effective?: string | null
          date_fin_prevue: string
          depart_original_id?: string | null
          id?: string
          numero_reconduction?: number
          reference_decision?: string | null
          statut?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archive?: boolean
          code_motif?: string
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_debut?: string
          date_decision?: string | null
          date_fin_effective?: string | null
          date_fin_prevue?: string
          depart_original_id?: string | null
          id?: string
          numero_reconduction?: number
          reference_decision?: string | null
          statut?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_departs_provisoires_code_motif_fkey"
            columns: ["code_motif"]
            isOneToOne: false
            referencedRelation: "ref_motif_depart_provisoire"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_departs_provisoires_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_departs_provisoires_depart_original_id_fkey"
            columns: ["depart_original_id"]
            isOneToOne: false
            referencedRelation: "collaborateur_departs_provisoires"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_diplomes: {
        Row: {
          archive: boolean
          code_diplome: string
          code_filiere_diplome: string | null
          code_niveau_diplome: string | null
          code_specialite_diplome: string | null
          code_type_etab: string | null
          collaborateur_id: string
          created_at: string
          date_obtention: string | null
          diplome_recrutement: boolean
          est_certification: boolean
          etablissement: string | null
          formation_interne: boolean
          id: string
          intitule_diplome: string | null
          updated_at: string
          validite_jusqu_a: string | null
        }
        Insert: {
          archive?: boolean
          code_diplome: string
          code_filiere_diplome?: string | null
          code_niveau_diplome?: string | null
          code_specialite_diplome?: string | null
          code_type_etab?: string | null
          collaborateur_id: string
          created_at?: string
          date_obtention?: string | null
          diplome_recrutement?: boolean
          est_certification?: boolean
          etablissement?: string | null
          formation_interne?: boolean
          id?: string
          intitule_diplome?: string | null
          updated_at?: string
          validite_jusqu_a?: string | null
        }
        Update: {
          archive?: boolean
          code_diplome?: string
          code_filiere_diplome?: string | null
          code_niveau_diplome?: string | null
          code_specialite_diplome?: string | null
          code_type_etab?: string | null
          collaborateur_id?: string
          created_at?: string
          date_obtention?: string | null
          diplome_recrutement?: boolean
          est_certification?: boolean
          etablissement?: string | null
          formation_interne?: boolean
          id?: string
          intitule_diplome?: string | null
          updated_at?: string
          validite_jusqu_a?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_diplomes_code_filiere_diplome_fkey"
            columns: ["code_filiere_diplome"]
            isOneToOne: false
            referencedRelation: "ref_filiere_diplome"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_diplomes_code_niveau_diplome_fkey"
            columns: ["code_niveau_diplome"]
            isOneToOne: false
            referencedRelation: "ref_niveau_diplome"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_diplomes_code_specialite_diplome_fkey"
            columns: ["code_specialite_diplome"]
            isOneToOne: false
            referencedRelation: "ref_specialite_diplome"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_diplomes_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_divers: {
        Row: {
          archive: boolean
          code_situation: string | null
          code_statut: string | null
          collaborateur_id: string
          communication_autorisee: boolean
          created_at: string
          electeur: boolean
          eligible: boolean
          est_handicape: boolean
          est_mutile: boolean
          id: string
          membre_association: boolean
          metier_base: string | null
          pension: number | null
          permis_conduire: boolean
          pompier: boolean
          premier_emploi: boolean
          rente: number | null
          secouriste: boolean
          taux_ipp: number | null
          technicien: boolean
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_situation?: string | null
          code_statut?: string | null
          collaborateur_id: string
          communication_autorisee?: boolean
          created_at?: string
          electeur?: boolean
          eligible?: boolean
          est_handicape?: boolean
          est_mutile?: boolean
          id?: string
          membre_association?: boolean
          metier_base?: string | null
          pension?: number | null
          permis_conduire?: boolean
          pompier?: boolean
          premier_emploi?: boolean
          rente?: number | null
          secouriste?: boolean
          taux_ipp?: number | null
          technicien?: boolean
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_situation?: string | null
          code_statut?: string | null
          collaborateur_id?: string
          communication_autorisee?: boolean
          created_at?: string
          electeur?: boolean
          eligible?: boolean
          est_handicape?: boolean
          est_mutile?: boolean
          id?: string
          membre_association?: boolean
          metier_base?: string | null
          pension?: number | null
          permis_conduire?: boolean
          pompier?: boolean
          premier_emploi?: boolean
          rente?: number | null
          secouriste?: boolean
          taux_ipp?: number | null
          technicien?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_divers_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_enfants: {
        Row: {
          archive: boolean
          code_genre: string
          code_handicap: string | null
          code_nationalite: string | null
          code_statut: string
          collaborateur_id: string
          couverture_medicale: string | null
          created_at: string
          date_debut_scolarite: string | null
          date_deces: string | null
          date_fin_prise_en_charge: string | null
          date_fin_scolarite: string | null
          date_naissance: string
          est_pris_en_charge: boolean
          est_scolarise: boolean
          etablissement_scolaire: string | null
          handicap: boolean
          id: string
          lieu_naissance: string | null
          niveau_scolaire: string | null
          nom: string | null
          observations: string | null
          prenom: string
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_genre?: string
          code_handicap?: string | null
          code_nationalite?: string | null
          code_statut?: string
          collaborateur_id: string
          couverture_medicale?: string | null
          created_at?: string
          date_debut_scolarite?: string | null
          date_deces?: string | null
          date_fin_prise_en_charge?: string | null
          date_fin_scolarite?: string | null
          date_naissance: string
          est_pris_en_charge?: boolean
          est_scolarise?: boolean
          etablissement_scolaire?: string | null
          handicap?: boolean
          id?: string
          lieu_naissance?: string | null
          niveau_scolaire?: string | null
          nom?: string | null
          observations?: string | null
          prenom: string
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_genre?: string
          code_handicap?: string | null
          code_nationalite?: string | null
          code_statut?: string
          collaborateur_id?: string
          couverture_medicale?: string | null
          created_at?: string
          date_debut_scolarite?: string | null
          date_deces?: string | null
          date_fin_prise_en_charge?: string | null
          date_fin_scolarite?: string | null
          date_naissance?: string
          est_pris_en_charge?: boolean
          est_scolarise?: boolean
          etablissement_scolaire?: string | null
          handicap?: boolean
          id?: string
          lieu_naissance?: string | null
          niveau_scolaire?: string | null
          nom?: string | null
          observations?: string | null
          prenom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_enfants_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_immatriculations: {
        Row: {
          archive: boolean
          code_organisme: string | null
          collaborateur_id: string
          created_at: string
          date_debut: string | null
          date_fin: string | null
          id: string
          numero_immatriculation: string
          observations: string | null
          reference_decision: string | null
          statut_immatriculation: string
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_organisme?: string | null
          collaborateur_id: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          numero_immatriculation: string
          observations?: string | null
          reference_decision?: string | null
          statut_immatriculation?: string
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_organisme?: string | null
          collaborateur_id?: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          numero_immatriculation?: string
          observations?: string | null
          reference_decision?: string | null
          statut_immatriculation?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_immatriculations_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_mandataires: {
        Row: {
          archive: boolean
          code_grade: string | null
          code_mandat: string
          collaborateur_id: string
          created_at: string
          debut_mandat: string | null
          fin_mandat: string | null
          id: string
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_grade?: string | null
          code_mandat: string
          collaborateur_id: string
          created_at?: string
          debut_mandat?: string | null
          fin_mandat?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_grade?: string | null
          code_mandat?: string
          collaborateur_id?: string
          created_at?: string
          debut_mandat?: string | null
          fin_mandat?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_mandataires_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_mouvements: {
        Row: {
          ancien_poste: string | null
          ancienne_unite_id: string | null
          archive: boolean
          code_type_mouvement: string
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          created_by: string | null
          date_decision: string | null
          date_effet: string
          date_fin_effective: string | null
          date_fin_prevue: string | null
          id: string
          nouveau_poste: string | null
          nouvelle_unite_id: string | null
          reference_decision: string | null
          statut: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ancien_poste?: string | null
          ancienne_unite_id?: string | null
          archive?: boolean
          code_type_mouvement: string
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_decision?: string | null
          date_effet: string
          date_fin_effective?: string | null
          date_fin_prevue?: string | null
          id?: string
          nouveau_poste?: string | null
          nouvelle_unite_id?: string | null
          reference_decision?: string | null
          statut?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ancien_poste?: string | null
          ancienne_unite_id?: string | null
          archive?: boolean
          code_type_mouvement?: string
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_decision?: string | null
          date_effet?: string
          date_fin_effective?: string | null
          date_fin_prevue?: string | null
          id?: string
          nouveau_poste?: string | null
          nouvelle_unite_id?: string | null
          reference_decision?: string | null
          statut?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_mouvements_ancienne_unite_id_fkey"
            columns: ["ancienne_unite_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_mouvements_code_type_mouvement_fkey"
            columns: ["code_type_mouvement"]
            isOneToOne: false
            referencedRelation: "ref_type_mouvement"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "collaborateur_mouvements_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_mouvements_nouvelle_unite_id_fkey"
            columns: ["nouvelle_unite_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_paiements: {
        Row: {
          actif: boolean
          archive: boolean
          code_agence: string | null
          code_banque: string | null
          code_bic: string | null
          code_iban: string | null
          code_mode: string
          collaborateur_id: string
          created_at: string
          date_debut: string
          date_fin: string | null
          id: string
          intitule_compte: string | null
          nom_agence: string | null
          numero_compte: string | null
          principal: boolean
          updated_at: string
        }
        Insert: {
          actif?: boolean
          archive?: boolean
          code_agence?: string | null
          code_banque?: string | null
          code_bic?: string | null
          code_iban?: string | null
          code_mode: string
          collaborateur_id: string
          created_at?: string
          date_debut: string
          date_fin?: string | null
          id?: string
          intitule_compte?: string | null
          nom_agence?: string | null
          numero_compte?: string | null
          principal?: boolean
          updated_at?: string
        }
        Update: {
          actif?: boolean
          archive?: boolean
          code_agence?: string | null
          code_banque?: string | null
          code_bic?: string | null
          code_iban?: string | null
          code_mode?: string
          collaborateur_id?: string
          created_at?: string
          date_debut?: string
          date_fin?: string | null
          id?: string
          intitule_compte?: string | null
          nom_agence?: string | null
          numero_compte?: string | null
          principal?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_paiements_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_plan_paie: {
        Row: {
          archive: boolean
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          created_by: string | null
          date_debut: string
          date_fin: string | null
          id: string
          plan_paie_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archive?: boolean
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_debut: string
          date_fin?: string | null
          id?: string
          plan_paie_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archive?: boolean
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          date_debut?: string
          date_fin?: string | null
          id?: string
          plan_paie_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_plan_paie_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_plan_paie_plan_paie_id_fkey"
            columns: ["plan_paie_id"]
            isOneToOne: false
            referencedRelation: "plan_paie"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_qualifications: {
        Row: {
          archive: boolean
          code_activite: string | null
          code_categorie: string | null
          code_categorie_professionnelle: string | null
          code_classe: string | null
          code_classification: string | null
          code_college: string | null
          code_decision: string | null
          code_echelle: string | null
          code_emploi: string
          code_filiere: string | null
          code_fonction: string | null
          code_grade: string | null
          code_motif: string
          code_niveau: string | null
          code_qualification: string | null
          code_responsabilite: string | null
          code_retraite: string | null
          code_secteur: string | null
          collaborateur_id: string
          commentaires: string | null
          created_at: string
          date_evolution: string
          decision_date: string | null
          decision_reference: string | null
          dominante_metier: string | null
          echelon_actuel: string | null
          id: string
          indice_reference: string | null
          indice_saisi: string | null
          points_attribues: number | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_activite?: string | null
          code_categorie?: string | null
          code_categorie_professionnelle?: string | null
          code_classe?: string | null
          code_classification?: string | null
          code_college?: string | null
          code_decision?: string | null
          code_echelle?: string | null
          code_emploi: string
          code_filiere?: string | null
          code_fonction?: string | null
          code_grade?: string | null
          code_motif: string
          code_niveau?: string | null
          code_qualification?: string | null
          code_responsabilite?: string | null
          code_retraite?: string | null
          code_secteur?: string | null
          collaborateur_id: string
          commentaires?: string | null
          created_at?: string
          date_evolution: string
          decision_date?: string | null
          decision_reference?: string | null
          dominante_metier?: string | null
          echelon_actuel?: string | null
          id?: string
          indice_reference?: string | null
          indice_saisi?: string | null
          points_attribues?: number | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_activite?: string | null
          code_categorie?: string | null
          code_categorie_professionnelle?: string | null
          code_classe?: string | null
          code_classification?: string | null
          code_college?: string | null
          code_decision?: string | null
          code_echelle?: string | null
          code_emploi?: string
          code_filiere?: string | null
          code_fonction?: string | null
          code_grade?: string | null
          code_motif?: string
          code_niveau?: string | null
          code_qualification?: string | null
          code_responsabilite?: string | null
          code_retraite?: string | null
          code_secteur?: string | null
          collaborateur_id?: string
          commentaires?: string | null
          created_at?: string
          date_evolution?: string
          decision_date?: string | null
          decision_reference?: string | null
          dominante_metier?: string | null
          echelon_actuel?: string | null
          id?: string
          indice_reference?: string | null
          indice_saisi?: string | null
          points_attribues?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_qualifications_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_salaires_fixes: {
        Row: {
          allocation_familiale: number | null
          archive: boolean
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          date_debut: string
          date_fin: string | null
          decision_ref: string | null
          id: string
          indemnite_caisse: number | null
          indemnite_fonction: number | null
          indemnite_representation: number | null
          indemnite_risque: number | null
          indemnite_telephone: number | null
          prime_anciennete: number | null
          prime_logement: number | null
          prime_transport: number | null
          salaire_base: number
          salaire_horaire: number | null
          salaire_journalier: number | null
          updated_at: string
          zone_fixe_01: number | null
          zone_fixe_02: number | null
          zone_fixe_03: number | null
          zone_fixe_04: number | null
          zone_fixe_05: number | null
          zone_fixe_06: number | null
          zone_fixe_07: number | null
          zone_fixe_08: number | null
          zone_fixe_09: number | null
          zone_fixe_10: number | null
          zone_fixe_11: number | null
          zone_fixe_12: number | null
          zone_fixe_13: number | null
          zone_fixe_14: number | null
          zone_fixe_15: number | null
          zone_fixe_16: number | null
          zone_fixe_17: number | null
          zone_fixe_18: number | null
          zone_fixe_19: number | null
          zone_fixe_20: number | null
        }
        Insert: {
          allocation_familiale?: number | null
          archive?: boolean
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          date_debut: string
          date_fin?: string | null
          decision_ref?: string | null
          id?: string
          indemnite_caisse?: number | null
          indemnite_fonction?: number | null
          indemnite_representation?: number | null
          indemnite_risque?: number | null
          indemnite_telephone?: number | null
          prime_anciennete?: number | null
          prime_logement?: number | null
          prime_transport?: number | null
          salaire_base: number
          salaire_horaire?: number | null
          salaire_journalier?: number | null
          updated_at?: string
          zone_fixe_01?: number | null
          zone_fixe_02?: number | null
          zone_fixe_03?: number | null
          zone_fixe_04?: number | null
          zone_fixe_05?: number | null
          zone_fixe_06?: number | null
          zone_fixe_07?: number | null
          zone_fixe_08?: number | null
          zone_fixe_09?: number | null
          zone_fixe_10?: number | null
          zone_fixe_11?: number | null
          zone_fixe_12?: number | null
          zone_fixe_13?: number | null
          zone_fixe_14?: number | null
          zone_fixe_15?: number | null
          zone_fixe_16?: number | null
          zone_fixe_17?: number | null
          zone_fixe_18?: number | null
          zone_fixe_19?: number | null
          zone_fixe_20?: number | null
        }
        Update: {
          allocation_familiale?: number | null
          archive?: boolean
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          date_debut?: string
          date_fin?: string | null
          decision_ref?: string | null
          id?: string
          indemnite_caisse?: number | null
          indemnite_fonction?: number | null
          indemnite_representation?: number | null
          indemnite_risque?: number | null
          indemnite_telephone?: number | null
          prime_anciennete?: number | null
          prime_logement?: number | null
          prime_transport?: number | null
          salaire_base?: number
          salaire_horaire?: number | null
          salaire_journalier?: number | null
          updated_at?: string
          zone_fixe_01?: number | null
          zone_fixe_02?: number | null
          zone_fixe_03?: number | null
          zone_fixe_04?: number | null
          zone_fixe_05?: number | null
          zone_fixe_06?: number | null
          zone_fixe_07?: number | null
          zone_fixe_08?: number | null
          zone_fixe_09?: number | null
          zone_fixe_10?: number | null
          zone_fixe_11?: number | null
          zone_fixe_12?: number | null
          zone_fixe_13?: number | null
          zone_fixe_14?: number | null
          zone_fixe_15?: number | null
          zone_fixe_16?: number | null
          zone_fixe_17?: number | null
          zone_fixe_18?: number | null
          zone_fixe_19?: number | null
          zone_fixe_20?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_salaires_fixes_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_syndiques: {
        Row: {
          archive: boolean
          code_college: string | null
          code_syndicat: string
          collaborateur_id: string
          created_at: string
          debut_syndicat: string | null
          fin_syndicat: string | null
          id: string
          numero_affiliation: string | null
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_college?: string | null
          code_syndicat: string
          collaborateur_id: string
          created_at?: string
          debut_syndicat?: string | null
          fin_syndicat?: string | null
          id?: string
          numero_affiliation?: string | null
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_college?: string | null
          code_syndicat?: string
          collaborateur_id?: string
          created_at?: string
          debut_syndicat?: string | null
          fin_syndicat?: string | null
          id?: string
          numero_affiliation?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_syndiques_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateur_workflow_managers: {
        Row: {
          actif: boolean
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          created_by: string | null
          id: string
          manager_n1_id: string | null
          manager_n2_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actif?: boolean
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manager_n1_id?: string | null
          manager_n2_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actif?: boolean
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manager_n1_id?: string | null
          manager_n2_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborateur_workflow_managers_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: true
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_workflow_managers_manager_n1_id_fkey"
            columns: ["manager_n1_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborateur_workflow_managers_manager_n2_id_fkey"
            columns: ["manager_n2_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborateurs: {
        Row: {
          amo_date_debut: string | null
          amo_date_fin: string | null
          ancien_matricule: string | null
          archive: boolean
          cimr_date_debut: string | null
          cimr_date_fin: string | null
          cin: string | null
          cin_date_debut: string | null
          cin_date_fin: string | null
          civilite: string | null
          cnss_date_debut: string | null
          cnss_date_fin: string | null
          code_genre: string
          code_nationalite: string | null
          code_nationalite2: string | null
          created_at: string
          date_naissance: string
          email_personnel: string | null
          email_professionnel: string | null
          fiscal_date_debut: string | null
          fiscal_date_fin: string | null
          gsm: string | null
          id: string
          lieu_naissance: string | null
          matricule: string
          nom: string
          nom_jeune_fille: string | null
          num_amo: string | null
          num_cimr: string | null
          num_cnss: string | null
          num_fiscal: string | null
          passeport: string | null
          passeport_date_debut: string | null
          passeport_date_fin: string | null
          photo_path: string | null
          prenom: string
          statut_collaborateur: string
          telephone: string | null
          updated_at: string
        }
        Insert: {
          amo_date_debut?: string | null
          amo_date_fin?: string | null
          ancien_matricule?: string | null
          archive?: boolean
          cimr_date_debut?: string | null
          cimr_date_fin?: string | null
          cin?: string | null
          cin_date_debut?: string | null
          cin_date_fin?: string | null
          civilite?: string | null
          cnss_date_debut?: string | null
          cnss_date_fin?: string | null
          code_genre?: string
          code_nationalite?: string | null
          code_nationalite2?: string | null
          created_at?: string
          date_naissance: string
          email_personnel?: string | null
          email_professionnel?: string | null
          fiscal_date_debut?: string | null
          fiscal_date_fin?: string | null
          gsm?: string | null
          id?: string
          lieu_naissance?: string | null
          matricule: string
          nom: string
          nom_jeune_fille?: string | null
          num_amo?: string | null
          num_cimr?: string | null
          num_cnss?: string | null
          num_fiscal?: string | null
          passeport?: string | null
          passeport_date_debut?: string | null
          passeport_date_fin?: string | null
          photo_path?: string | null
          prenom: string
          statut_collaborateur?: string
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          amo_date_debut?: string | null
          amo_date_fin?: string | null
          ancien_matricule?: string | null
          archive?: boolean
          cimr_date_debut?: string | null
          cimr_date_fin?: string | null
          cin?: string | null
          cin_date_debut?: string | null
          cin_date_fin?: string | null
          civilite?: string | null
          cnss_date_debut?: string | null
          cnss_date_fin?: string | null
          code_genre?: string
          code_nationalite?: string | null
          code_nationalite2?: string | null
          created_at?: string
          date_naissance?: string
          email_personnel?: string | null
          email_professionnel?: string | null
          fiscal_date_debut?: string | null
          fiscal_date_fin?: string | null
          gsm?: string | null
          id?: string
          lieu_naissance?: string | null
          matricule?: string
          nom?: string
          nom_jeune_fille?: string | null
          num_amo?: string | null
          num_cimr?: string | null
          num_cnss?: string | null
          num_fiscal?: string | null
          passeport?: string | null
          passeport_date_debut?: string | null
          passeport_date_fin?: string | null
          photo_path?: string | null
          prenom?: string
          statut_collaborateur?: string
          telephone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cong_consommation: {
        Row: {
          archive: boolean
          code_type_conge: string
          collaborateur_id: string
          created_at: string
          date_annulation: string | null
          date_debut: string
          date_retour: string
          debut_demi_journee: string | null
          demande_id: string | null
          est_annulee: boolean
          exercice: number
          fin_demi_journee: string | null
          id: string
          motif_annulation: string | null
          nbr_jours_calendaires: number
          nbr_jours_decomptes: number
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_type_conge: string
          collaborateur_id: string
          created_at?: string
          date_annulation?: string | null
          date_debut: string
          date_retour: string
          debut_demi_journee?: string | null
          demande_id?: string | null
          est_annulee?: boolean
          exercice: number
          fin_demi_journee?: string | null
          id?: string
          motif_annulation?: string | null
          nbr_jours_calendaires?: number
          nbr_jours_decomptes?: number
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_type_conge?: string
          collaborateur_id?: string
          created_at?: string
          date_annulation?: string | null
          date_debut?: string
          date_retour?: string
          debut_demi_journee?: string | null
          demande_id?: string | null
          est_annulee?: boolean
          exercice?: number
          fin_demi_journee?: string | null
          id?: string
          motif_annulation?: string | null
          nbr_jours_calendaires?: number
          nbr_jours_decomptes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cong_consommation_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cong_consommation_demande_id_fkey"
            columns: ["demande_id"]
            isOneToOne: false
            referencedRelation: "cong_demandes"
            referencedColumns: ["id"]
          },
        ]
      }
      cong_demandes: {
        Row: {
          archive: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire_collaborateur: string | null
          commentaire_gestionnaire: string | null
          created_at: string
          date_debut: string
          date_fin_absence: string
          date_reprise_effective: string | null
          date_retour: string
          date_soumission: string | null
          date_validation: string | null
          debut_demi_journee: string | null
          demande_originale_id: string | null
          est_report_reliquat: boolean
          fin_demi_journee: string | null
          id: string
          motif_refus: string | null
          nbr_jours_calendaires: number | null
          nbr_jours_decomptes: number | null
          piece_jointe_path: string | null
          reconduction_numero: number | null
          reliquat_id: string | null
          statut: string
          updated_at: string
          valideur_id: string | null
        }
        Insert: {
          archive?: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire_collaborateur?: string | null
          commentaire_gestionnaire?: string | null
          created_at?: string
          date_debut: string
          date_fin_absence: string
          date_reprise_effective?: string | null
          date_retour: string
          date_soumission?: string | null
          date_validation?: string | null
          debut_demi_journee?: string | null
          demande_originale_id?: string | null
          est_report_reliquat?: boolean
          fin_demi_journee?: string | null
          id?: string
          motif_refus?: string | null
          nbr_jours_calendaires?: number | null
          nbr_jours_decomptes?: number | null
          piece_jointe_path?: string | null
          reconduction_numero?: number | null
          reliquat_id?: string | null
          statut?: string
          updated_at?: string
          valideur_id?: string | null
        }
        Update: {
          archive?: boolean
          code_type_conge?: string
          collaborateur_id?: string
          commentaire_collaborateur?: string | null
          commentaire_gestionnaire?: string | null
          created_at?: string
          date_debut?: string
          date_fin_absence?: string
          date_reprise_effective?: string | null
          date_retour?: string
          date_soumission?: string | null
          date_validation?: string | null
          debut_demi_journee?: string | null
          demande_originale_id?: string | null
          est_report_reliquat?: boolean
          fin_demi_journee?: string | null
          id?: string
          motif_refus?: string | null
          nbr_jours_calendaires?: number | null
          nbr_jours_decomptes?: number | null
          piece_jointe_path?: string | null
          reconduction_numero?: number | null
          reliquat_id?: string | null
          statut?: string
          updated_at?: string
          valideur_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cong_demandes_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      cong_droits: {
        Row: {
          archive: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          exercice: number
          id: string
          jours_acquis: number
          periode_debut: string
          periode_fin: string
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          exercice: number
          id?: string
          jours_acquis?: number
          periode_debut: string
          periode_fin: string
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_type_conge?: string
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          exercice?: number
          id?: string
          jours_acquis?: number
          periode_debut?: string
          periode_fin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cong_droits_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      cong_reliquat: {
        Row: {
          archive: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire: string | null
          created_at: string
          date_butoir: string
          date_expiration: string | null
          exercice_origine: number
          exercice_report: number
          id: string
          jours_consommes: number
          jours_reliquat: number
          statut: string
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_type_conge: string
          collaborateur_id: string
          commentaire?: string | null
          created_at?: string
          date_butoir: string
          date_expiration?: string | null
          exercice_origine: number
          exercice_report: number
          id?: string
          jours_consommes?: number
          jours_reliquat?: number
          statut?: string
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_type_conge?: string
          collaborateur_id?: string
          commentaire?: string | null
          created_at?: string
          date_butoir?: string
          date_expiration?: string | null
          exercice_origine?: number
          exercice_report?: number
          id?: string
          jours_consommes?: number
          jours_reliquat?: number
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cong_reliquat_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      cong_solde: {
        Row: {
          archive: boolean
          code_type_conge: string
          collaborateur_id: string
          created_at: string
          date_calcul: string
          exercice: number
          id: string
          reliquat_reporte: number
          solde_acquis: number
          solde_en_attente: number
          solde_pris: number
          solde_restant: number
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_type_conge: string
          collaborateur_id: string
          created_at?: string
          date_calcul?: string
          exercice: number
          id?: string
          reliquat_reporte?: number
          solde_acquis?: number
          solde_en_attente?: number
          solde_pris?: number
          solde_restant?: number
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_type_conge?: string
          collaborateur_id?: string
          created_at?: string
          date_calcul?: string
          exercice?: number
          id?: string
          reliquat_reporte?: number
          solde_acquis?: number
          solde_en_attente?: number
          solde_pris?: number
          solde_restant?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cong_solde_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      etablissements: {
        Row: {
          actif: boolean | null
          adresse: string | null
          code: string | null
          code_commune: string | null
          code_departement: string | null
          code_pays: string | null
          code_postal: string | null
          code_region: string | null
          code_type_etablissement: string | null
          created_at: string
          effectif: number | null
          email: string | null
          est_siege: boolean | null
          id: string
          libelle: string
          siret: string | null
          societe_id: string
          telephone: string | null
          updated_at: string
          ville: string | null
        }
        Insert: {
          actif?: boolean | null
          adresse?: string | null
          code?: string | null
          code_commune?: string | null
          code_departement?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_type_etablissement?: string | null
          created_at?: string
          effectif?: number | null
          email?: string | null
          est_siege?: boolean | null
          id?: string
          libelle: string
          siret?: string | null
          societe_id: string
          telephone?: string | null
          updated_at?: string
          ville?: string | null
        }
        Update: {
          actif?: boolean | null
          adresse?: string | null
          code?: string | null
          code_commune?: string | null
          code_departement?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_type_etablissement?: string | null
          created_at?: string
          effectif?: number | null
          email?: string | null
          est_siege?: boolean | null
          id?: string
          libelle?: string
          siret?: string | null
          societe_id?: string
          telephone?: string | null
          updated_at?: string
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etablissements_code_commune_fkey"
            columns: ["code_commune"]
            isOneToOne: false
            referencedRelation: "ref_commune"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "etablissements_code_departement_fkey"
            columns: ["code_departement"]
            isOneToOne: false
            referencedRelation: "ref_departement"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "etablissements_code_pays_fkey"
            columns: ["code_pays"]
            isOneToOne: false
            referencedRelation: "ref_pays"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "etablissements_code_region_fkey"
            columns: ["code_region"]
            isOneToOne: false
            referencedRelation: "ref_region"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "etablissements_code_type_etablissement_fkey"
            columns: ["code_type_etablissement"]
            isOneToOne: false
            referencedRelation: "ref_type_etablissement"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "etablissements_societe_id_fkey"
            columns: ["societe_id"]
            isOneToOne: false
            referencedRelation: "societes"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_configs: {
        Row: {
          actif: boolean
          categorie: string
          code: string
          config: Json
          created_at: string
          description: string | null
          id: string
          libelle: string
          type_kpi: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          categorie?: string
          code: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          libelle: string
          type_kpi?: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          categorie?: string
          code?: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          libelle?: string
          type_kpi?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_publications: {
        Row: {
          actif: boolean
          created_at: string
          espace: string
          id: string
          kpi_id: string
          position: number
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          espace: string
          id?: string
          kpi_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          espace?: string
          id?: string
          kpi_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_publications_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpi_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_rh: {
        Row: {
          actif: boolean
          categorie: string
          code: string
          created_at: string
          description: string | null
          id: string
          libelle: string
          type_valeur: string
          unite: string | null
          updated_at: string
          valeur: string
        }
        Insert: {
          actif?: boolean
          categorie?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          libelle: string
          type_valeur?: string
          unite?: string | null
          updated_at?: string
          valeur: string
        }
        Update: {
          actif?: boolean
          categorie?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          libelle?: string
          type_valeur?: string
          unite?: string | null
          updated_at?: string
          valeur?: string
        }
        Relationships: []
      }
      plan_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          frequence: string
          frequence_calcul: string
          frequence_raz_cumuls: string
          id: string
          libelle: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          frequence?: string
          frequence_calcul?: string
          frequence_raz_cumuls?: string
          id?: string
          libelle: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          frequence?: string
          frequence_calcul?: string
          frequence_raz_cumuls?: string
          id?: string
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          collaborateur_id: string | null
          created_at: string
          email: string | null
          id: string
          nom: string | null
          poste: string | null
          prenom: string | null
          telephone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          collaborateur_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nom?: string | null
          poste?: string | null
          prenom?: string | null
          telephone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          collaborateur_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nom?: string | null
          poste?: string | null
          prenom?: string | null
          telephone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_activite: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_avantage: {
        Row: {
          actif: boolean | null
          code: string
          code_rubrique: string | null
          description: string | null
          libelle: string
          ordre: number | null
          pris_en_compte_paie: boolean | null
          pris_en_net: boolean | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_rubrique?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
          pris_en_compte_paie?: boolean | null
          pris_en_net?: boolean | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_rubrique?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
          pris_en_compte_paie?: boolean | null
          pris_en_net?: boolean | null
        }
        Relationships: []
      }
      ref_banque: {
        Row: {
          actif: boolean | null
          code: string
          code_pays: string | null
          libelle: string
          swift: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_pays?: string | null
          libelle: string
          swift?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_pays?: string | null
          libelle?: string
          swift?: string | null
        }
        Relationships: []
      }
      ref_categorie_emploi: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_categorie_professionnelle: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_classe: {
        Row: {
          actif: boolean | null
          code: string
          created_at: string | null
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          created_at?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          created_at?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ref_classification: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_coefficient: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          ordre: number | null
          valeur: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          ordre?: number | null
          valeur?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          ordre?: number | null
          valeur?: number | null
        }
        Relationships: []
      }
      ref_college: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_commune: {
        Row: {
          actif: boolean | null
          code: string
          code_departement: string | null
          code_postal: string | null
          code_ville: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_departement?: string | null
          code_postal?: string | null
          code_ville?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_departement?: string | null
          code_postal?: string | null
          code_ville?: string | null
          libelle?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_commune_code_ville_fkey"
            columns: ["code_ville"]
            isOneToOne: false
            referencedRelation: "ref_ville"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_competence: {
        Row: {
          actif: boolean | null
          code: string
          code_type_competence: string | null
          description: string | null
          libelle: string
          ordre: number | null
          type_competence: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_type_competence?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
          type_competence?: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_type_competence?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
          type_competence?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_competence_code_type_competence_fkey"
            columns: ["code_type_competence"]
            isOneToOne: false
            referencedRelation: "ref_type_competence"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_constante_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          date_debut: string | null
          date_fin: string | null
          id: string
          libelle: string
          type_constante: string
          updated_at: string
          valeur: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          libelle: string
          type_constante?: string
          updated_at?: string
          valeur: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          libelle?: string
          type_constante?: string
          updated_at?: string
          valeur?: string
        }
        Relationships: []
      }
      ref_convention_collective: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          numero_idcc: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          numero_idcc?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          numero_idcc?: string | null
        }
        Relationships: []
      }
      ref_departement: {
        Row: {
          actif: boolean | null
          code: string
          code_region: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_region?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_region?: string | null
          libelle?: string
        }
        Relationships: []
      }
      ref_devise: {
        Row: {
          actif: boolean | null
          code: string
          code_pays: string | null
          libelle: string
          symbole: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_pays?: string | null
          libelle: string
          symbole?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_pays?: string | null
          libelle?: string
          symbole?: string | null
        }
        Relationships: []
      }
      ref_domaine_formation: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_echelle: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_echelon: {
        Row: {
          actif: boolean | null
          code: string
          created_at: string | null
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          created_at?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          created_at?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ref_emploi: {
        Row: {
          actif: boolean | null
          code: string
          code_classification: string | null
          code_metier: string
          created_at: string
          description: string | null
          est_emploi_responsabilite: boolean
          libelle: string
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_classification?: string | null
          code_metier: string
          created_at?: string
          description?: string | null
          est_emploi_responsabilite?: boolean
          libelle: string
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_classification?: string | null
          code_metier?: string
          created_at?: string
          description?: string | null
          est_emploi_responsabilite?: boolean
          libelle?: string
          ordre?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_emploi_code_classification_fkey"
            columns: ["code_classification"]
            isOneToOne: false
            referencedRelation: "ref_classification"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ref_emploi_code_metier_fkey"
            columns: ["code_metier"]
            isOneToOne: false
            referencedRelation: "ref_metier"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_evenement_ferie: {
        Row: {
          actif: boolean
          code: string
          code_famille: string | null
          created_at: string
          description: string | null
          libelle: string
          nb_jours_defaut: number
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          code_famille?: string | null
          created_at?: string
          description?: string | null
          libelle: string
          nb_jours_defaut?: number
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          code_famille?: string | null
          created_at?: string
          description?: string | null
          libelle?: string
          nb_jours_defaut?: number
          ordre?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_evenement_ferie_code_famille_fkey"
            columns: ["code_famille"]
            isOneToOne: false
            referencedRelation: "ref_famille_ferie"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_famille_conge: {
        Row: {
          actif: boolean
          code: string
          couleur: string | null
          created_at: string
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          couleur?: string | null
          created_at?: string
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          couleur?: string | null
          created_at?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ref_famille_ferie: {
        Row: {
          actif: boolean
          code: string
          couleur: string
          created_at: string
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          couleur?: string
          created_at?: string
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          couleur?: string
          created_at?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ref_famille_metier: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_famille_rubrique_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          libelle: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          libelle: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_filiere: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_filiere_diplome: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_flux_rubrique_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          libelle: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          libelle: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_fonction: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_frequence_paie_calendrier: {
        Row: {
          calendrier_paie_id: string
          code_frequence: string
          created_at: string
          id: string
          type_frequence: string
        }
        Insert: {
          calendrier_paie_id: string
          code_frequence: string
          created_at?: string
          id?: string
          type_frequence?: string
        }
        Update: {
          calendrier_paie_id?: string
          code_frequence?: string
          created_at?: string
          id?: string
          type_frequence?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_frequence_paie_calendrier_calendrier_paie_id_fkey"
            columns: ["calendrier_paie_id"]
            isOneToOne: false
            referencedRelation: "calendrier_paie"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_frequence_rubrique_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          libelle: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          libelle: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_genre: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_grade: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_grade_mandat: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_imputation_comptable: {
        Row: {
          actif: boolean
          code_compte: string
          created_at: string
          id: string
          intitule_compte: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code_compte: string
          created_at?: string
          id?: string
          intitule_compte?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code_compte?: string
          created_at?: string
          id?: string
          intitule_compte?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ref_jours_feries: {
        Row: {
          actif: boolean
          annee: number
          code_evenement: string
          code_famille: string | null
          created_at: string
          date_debut: string
          id: string
          libelle_specifique: string | null
          nombre_jours: number
          observations: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          annee: number
          code_evenement: string
          code_famille?: string | null
          created_at?: string
          date_debut: string
          id?: string
          libelle_specifique?: string | null
          nombre_jours?: number
          observations?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          annee?: number
          code_evenement?: string
          code_famille?: string | null
          created_at?: string
          date_debut?: string
          id?: string
          libelle_specifique?: string | null
          nombre_jours?: number
          observations?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_jours_feries_code_evenement_fkey"
            columns: ["code_evenement"]
            isOneToOne: false
            referencedRelation: "ref_evenement_ferie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ref_jours_feries_code_famille_fkey"
            columns: ["code_famille"]
            isOneToOne: false
            referencedRelation: "ref_famille_ferie"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_lien_parente: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_mandat_type: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_metier: {
        Row: {
          actif: boolean | null
          code: string
          code_famille: string | null
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_famille?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_famille?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ref_metier_code_famille_fkey"
            columns: ["code_famille"]
            isOneToOne: false
            referencedRelation: "ref_famille_metier"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_mode_paiement: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_absence: {
        Row: {
          actif: boolean | null
          code: string
          code_type_absence: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_type_absence?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_type_absence?: string | null
          libelle?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_motif_absence_code_type_absence_fkey"
            columns: ["code_type_absence"]
            isOneToOne: false
            referencedRelation: "ref_type_absence"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_motif_affectation: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_classification: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_depart_provisoire: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          duree_globale_max_jours: number | null
          duree_max_periode_jours: number | null
          libelle: string
          nombre_reconductions_max: number | null
          reconductible: boolean
          reste_dans_effectif: boolean
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          duree_globale_max_jours?: number | null
          duree_max_periode_jours?: number | null
          libelle: string
          nombre_reconductions_max?: number | null
          reconductible?: boolean
          reste_dans_effectif?: boolean
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          duree_globale_max_jours?: number | null
          duree_max_periode_jours?: number | null
          libelle?: string
          nombre_reconductions_max?: number | null
          reconductible?: boolean
          reste_dans_effectif?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ref_motif_evolution: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_recrutement: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_rupture: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_motif_sortie: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_nationalite: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_niveau_competence: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
          poids: number
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
          poids?: number
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
          poids?: number
        }
        Relationships: []
      }
      ref_niveau_diplome: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          nombre_annees: number | null
          ordre: number | null
          rang: number
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          nombre_annees?: number | null
          ordre?: number | null
          rang?: number
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          nombre_annees?: number | null
          ordre?: number | null
          rang?: number
        }
        Relationships: []
      }
      ref_niveau_qualification: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_organisme_formation: {
        Row: {
          actif: boolean | null
          contact: string | null
          created_at: string | null
          email: string | null
          id: string
          nom: string
          numero_datadock: string | null
          siret: string | null
          telephone: string | null
        }
        Insert: {
          actif?: boolean | null
          contact?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nom: string
          numero_datadock?: string | null
          siret?: string | null
          telephone?: string | null
        }
        Update: {
          actif?: boolean | null
          contact?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nom?: string
          numero_datadock?: string | null
          siret?: string | null
          telephone?: string | null
        }
        Relationships: []
      }
      ref_organisme_social: {
        Row: {
          actif: boolean | null
          adresse: string | null
          code: string
          libelle: string
          type: string | null
        }
        Insert: {
          actif?: boolean | null
          adresse?: string | null
          code: string
          libelle: string
          type?: string | null
        }
        Update: {
          actif?: boolean | null
          adresse?: string | null
          code?: string
          libelle?: string
          type?: string | null
        }
        Relationships: []
      }
      ref_pays: {
        Row: {
          actif: boolean | null
          code: string
          code_pays_alpha2: string | null
          code_pays_num: number | null
          continent: string | null
          devise: string | null
          langue_principale: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_pays_alpha2?: string | null
          code_pays_num?: number | null
          continent?: string | null
          devise?: string | null
          langue_principale?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_pays_alpha2?: string | null
          code_pays_num?: number | null
          continent?: string | null
          devise?: string | null
          langue_principale?: string | null
          libelle?: string
        }
        Relationships: []
      }
      ref_poste: {
        Row: {
          actif: boolean | null
          code: string
          code_classification: string | null
          code_emploi: string | null
          code_etat_poste: string
          code_statut_poste: string
          description: string | null
          libelle: string
          nombre_postes: number
          ordre: number | null
          qualifications_requises: string | null
          unite_id: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_classification?: string | null
          code_emploi?: string | null
          code_etat_poste?: string
          code_statut_poste?: string
          description?: string | null
          libelle: string
          nombre_postes?: number
          ordre?: number | null
          qualifications_requises?: string | null
          unite_id?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_classification?: string | null
          code_emploi?: string | null
          code_etat_poste?: string
          code_statut_poste?: string
          description?: string | null
          libelle?: string
          nombre_postes?: number
          ordre?: number | null
          qualifications_requises?: string | null
          unite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ref_poste_code_classification_fkey"
            columns: ["code_classification"]
            isOneToOne: false
            referencedRelation: "ref_classification"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ref_poste_unite_id_fkey"
            columns: ["unite_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_poste_instances: {
        Row: {
          archive: boolean
          code_etat: string
          code_instance: string
          code_poste: string
          collaborateur_id: string | null
          created_at: string
          id: string
          numero_instance: number
          updated_at: string
        }
        Insert: {
          archive?: boolean
          code_etat?: string
          code_instance: string
          code_poste: string
          collaborateur_id?: string | null
          created_at?: string
          id?: string
          numero_instance?: number
          updated_at?: string
        }
        Update: {
          archive?: boolean
          code_etat?: string
          code_instance?: string
          code_poste?: string
          collaborateur_id?: string | null
          created_at?: string
          id?: string
          numero_instance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_poste_instances_code_poste_fkey"
            columns: ["code_poste"]
            isOneToOne: false
            referencedRelation: "ref_poste"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ref_poste_instances_collaborateur_id_fkey"
            columns: ["collaborateur_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_priorite: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          niveau: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          niveau?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          niveau?: number | null
        }
        Relationships: []
      }
      ref_qualification: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_region: {
        Row: {
          actif: boolean | null
          code: string
          code_pays: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_pays?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_pays?: string | null
          libelle?: string
        }
        Relationships: []
      }
      ref_regle_calcul_standard: {
        Row: {
          actif: boolean
          attribut_calcule: string
          code: string
          created_at: string
          description: string | null
          formule_lisible: string
          libelle: string
          ordre_affichage: number
          unite: string | null
          updated_at: string
          variable_cible: string
          variables_requises: Json
        }
        Insert: {
          actif?: boolean
          attribut_calcule: string
          code: string
          created_at?: string
          description?: string | null
          formule_lisible: string
          libelle: string
          ordre_affichage?: number
          unite?: string | null
          updated_at?: string
          variable_cible?: string
          variables_requises?: Json
        }
        Update: {
          actif?: boolean
          attribut_calcule?: string
          code?: string
          created_at?: string
          description?: string | null
          formule_lisible?: string
          libelle?: string
          ordre_affichage?: number
          unite?: string | null
          updated_at?: string
          variable_cible?: string
          variables_requises?: Json
        }
        Relationships: []
      }
      ref_responsabilite: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_rubrique_paie: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          ordre: number | null
          sens: string | null
          type: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          ordre?: number | null
          sens?: string | null
          type?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          ordre?: number | null
          sens?: string | null
          type?: string | null
        }
        Relationships: []
      }
      ref_secteur_activite: {
        Row: {
          actif: boolean | null
          code: string
          code_naf: string | null
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_naf?: string | null
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_naf?: string | null
          libelle?: string
        }
        Relationships: []
      }
      ref_situation_familiale: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_source_recrutement: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_specialite_diplome: {
        Row: {
          actif: boolean
          code: string
          code_filiere: string | null
          created_at: string
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          code_filiere?: string | null
          created_at?: string
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          code_filiere?: string | null
          created_at?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_specialite_diplome_code_filiere_fkey"
            columns: ["code_filiere"]
            isOneToOne: false
            referencedRelation: "ref_filiere_diplome"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_statut: {
        Row: {
          actif: boolean | null
          code: string
          contexte: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          contexte?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          contexte?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_statut_cnss: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          libelle: string
          ordre_affichage: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          libelle: string
          ordre_affichage?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          libelle?: string
          ordre_affichage?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ref_statut_contrat: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_syndicat: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_taux_cotisation: {
        Row: {
          actif: boolean | null
          code_organisme: string | null
          date_debut: string | null
          date_fin: string | null
          id: string
          libelle: string
          taux_patronal: number | null
          taux_salarial: number | null
        }
        Insert: {
          actif?: boolean | null
          code_organisme?: string | null
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          libelle: string
          taux_patronal?: number | null
          taux_salarial?: number | null
        }
        Update: {
          actif?: boolean | null
          code_organisme?: string | null
          date_debut?: string | null
          date_fin?: string | null
          id?: string
          libelle?: string
          taux_patronal?: number | null
          taux_salarial?: number | null
        }
        Relationships: []
      }
      ref_type_absence: {
        Row: {
          actif: boolean | null
          code: string
          impacte_conges: boolean | null
          impacte_paie: boolean | null
          justificatif_requis: boolean | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          impacte_conges?: boolean | null
          impacte_paie?: boolean | null
          justificatif_requis?: boolean | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          impacte_conges?: boolean | null
          impacte_paie?: boolean | null
          justificatif_requis?: boolean | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_affiliation: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_competence: {
        Row: {
          actif: boolean | null
          code: string
          created_at: string | null
          description: string | null
          libelle: string
          ordre: number | null
          updated_at: string | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          created_at?: string | null
          description?: string | null
          libelle: string
          ordre?: number | null
          updated_at?: string | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          created_at?: string | null
          description?: string | null
          libelle?: string
          ordre?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ref_type_conge: {
        Row: {
          actif: boolean | null
          anciennete_min_mois: number | null
          code: string
          code_famille: string | null
          code_type_conge_parent: string | null
          code_type_jour: string
          condition_particuliere: string | null
          created_at: string
          decision_reference: string | null
          description: string | null
          droit_convention_jours: number | null
          droit_legal_jours: number | null
          droit_particulier_jours: number | null
          duree_max: number | null
          impacte_paie: boolean
          indemnisable_amo: boolean
          indemnisable_cimr: boolean
          indemnisable_cnss: boolean
          interdit_reliquat: boolean
          justificatif_obligatoire: boolean
          libelle: string
          ordre: number | null
          population_condition: string | null
          population_criteres: Json | null
          preavis_jours: number | null
          reconduction_autorisee: boolean
          reconduction_duree_jours: number | null
          reconduction_max_nombre: number | null
          reference_convention: string | null
          reference_legale: string | null
          report_action_solde_restant: string | null
          report_autorise: boolean
          report_condition: string | null
          report_cumul_autorise: boolean
          report_cumul_max_exercices: number | null
          report_date_butoir: string | null
          report_delai_consommation_mois: number | null
          report_mode_plafond: string | null
          report_plafond_jours: number | null
          report_plafond_pct: number | null
          report_type_butoir: string | null
          reprise_obligatoire: boolean
          unite: string | null
          updated_at: string
          workflow_obligatoire: boolean
        }
        Insert: {
          actif?: boolean | null
          anciennete_min_mois?: number | null
          code: string
          code_famille?: string | null
          code_type_conge_parent?: string | null
          code_type_jour?: string
          condition_particuliere?: string | null
          created_at?: string
          decision_reference?: string | null
          description?: string | null
          droit_convention_jours?: number | null
          droit_legal_jours?: number | null
          droit_particulier_jours?: number | null
          duree_max?: number | null
          impacte_paie?: boolean
          indemnisable_amo?: boolean
          indemnisable_cimr?: boolean
          indemnisable_cnss?: boolean
          interdit_reliquat?: boolean
          justificatif_obligatoire?: boolean
          libelle: string
          ordre?: number | null
          population_condition?: string | null
          population_criteres?: Json | null
          preavis_jours?: number | null
          reconduction_autorisee?: boolean
          reconduction_duree_jours?: number | null
          reconduction_max_nombre?: number | null
          reference_convention?: string | null
          reference_legale?: string | null
          report_action_solde_restant?: string | null
          report_autorise?: boolean
          report_condition?: string | null
          report_cumul_autorise?: boolean
          report_cumul_max_exercices?: number | null
          report_date_butoir?: string | null
          report_delai_consommation_mois?: number | null
          report_mode_plafond?: string | null
          report_plafond_jours?: number | null
          report_plafond_pct?: number | null
          report_type_butoir?: string | null
          reprise_obligatoire?: boolean
          unite?: string | null
          updated_at?: string
          workflow_obligatoire?: boolean
        }
        Update: {
          actif?: boolean | null
          anciennete_min_mois?: number | null
          code?: string
          code_famille?: string | null
          code_type_conge_parent?: string | null
          code_type_jour?: string
          condition_particuliere?: string | null
          created_at?: string
          decision_reference?: string | null
          description?: string | null
          droit_convention_jours?: number | null
          droit_legal_jours?: number | null
          droit_particulier_jours?: number | null
          duree_max?: number | null
          impacte_paie?: boolean
          indemnisable_amo?: boolean
          indemnisable_cimr?: boolean
          indemnisable_cnss?: boolean
          interdit_reliquat?: boolean
          justificatif_obligatoire?: boolean
          libelle?: string
          ordre?: number | null
          population_condition?: string | null
          population_criteres?: Json | null
          preavis_jours?: number | null
          reconduction_autorisee?: boolean
          reconduction_duree_jours?: number | null
          reconduction_max_nombre?: number | null
          reference_convention?: string | null
          reference_legale?: string | null
          report_action_solde_restant?: string | null
          report_autorise?: boolean
          report_condition?: string | null
          report_cumul_autorise?: boolean
          report_cumul_max_exercices?: number | null
          report_date_butoir?: string | null
          report_delai_consommation_mois?: number | null
          report_mode_plafond?: string | null
          report_plafond_jours?: number | null
          report_plafond_pct?: number | null
          report_type_butoir?: string | null
          reprise_obligatoire?: boolean
          unite?: string | null
          updated_at?: string
          workflow_obligatoire?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_type_conge_famille"
            columns: ["code_famille"]
            isOneToOne: false
            referencedRelation: "ref_famille_conge"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fk_type_conge_parent"
            columns: ["code_type_conge_parent"]
            isOneToOne: false
            referencedRelation: "ref_type_conge"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_type_conge_histo: {
        Row: {
          actif: boolean
          action_date: string
          action_type: string
          action_user: string | null
          anciennete_min_mois: number | null
          code: string
          code_famille: string | null
          code_type_conge_parent: string | null
          code_type_jour: string
          condition_particuliere: string | null
          decision_reference: string | null
          droit_convention_jours: number | null
          droit_legal_jours: number | null
          droit_particulier_jours: number | null
          id: string
          impacte_paie: boolean
          indemnisable_amo: boolean
          indemnisable_cimr: boolean
          indemnisable_cnss: boolean
          justificatif_obligatoire: boolean
          libelle: string
          preavis_jours: number | null
          reference_convention: string | null
          reference_legale: string | null
          workflow_obligatoire: boolean
        }
        Insert: {
          actif?: boolean
          action_date?: string
          action_type: string
          action_user?: string | null
          anciennete_min_mois?: number | null
          code: string
          code_famille?: string | null
          code_type_conge_parent?: string | null
          code_type_jour?: string
          condition_particuliere?: string | null
          decision_reference?: string | null
          droit_convention_jours?: number | null
          droit_legal_jours?: number | null
          droit_particulier_jours?: number | null
          id?: string
          impacte_paie?: boolean
          indemnisable_amo?: boolean
          indemnisable_cimr?: boolean
          indemnisable_cnss?: boolean
          justificatif_obligatoire?: boolean
          libelle: string
          preavis_jours?: number | null
          reference_convention?: string | null
          reference_legale?: string | null
          workflow_obligatoire?: boolean
        }
        Update: {
          actif?: boolean
          action_date?: string
          action_type?: string
          action_user?: string | null
          anciennete_min_mois?: number | null
          code?: string
          code_famille?: string | null
          code_type_conge_parent?: string | null
          code_type_jour?: string
          condition_particuliere?: string | null
          decision_reference?: string | null
          droit_convention_jours?: number | null
          droit_legal_jours?: number | null
          droit_particulier_jours?: number | null
          id?: string
          impacte_paie?: boolean
          indemnisable_amo?: boolean
          indemnisable_cimr?: boolean
          indemnisable_cnss?: boolean
          justificatif_obligatoire?: boolean
          libelle?: string
          preavis_jours?: number | null
          reference_convention?: string | null
          reference_legale?: string | null
          workflow_obligatoire?: boolean
        }
        Relationships: []
      }
      ref_type_contrat: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_diplome: {
        Row: {
          actif: boolean | null
          code: string
          code_niveau_diplome: string | null
          libelle: string
          niveau: string | null
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_niveau_diplome?: string | null
          libelle: string
          niveau?: string | null
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_niveau_diplome?: string | null
          libelle?: string
          niveau?: string | null
          ordre?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ref_type_diplome_code_niveau_diplome_fkey"
            columns: ["code_niveau_diplome"]
            isOneToOne: false
            referencedRelation: "ref_niveau_diplome"
            referencedColumns: ["code"]
          },
        ]
      }
      ref_type_document: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          obligatoire: boolean | null
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          obligatoire?: boolean | null
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          obligatoire?: boolean | null
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_etablissement: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_formation: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
        }
        Relationships: []
      }
      ref_type_handicap: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_jour: {
        Row: {
          actif: boolean
          code: string
          compte_dimanche: boolean
          compte_feries: boolean
          compte_samedi: boolean
          created_at: string
          description: string | null
          jours_semaine: Json
          libelle: string
          ordre: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          compte_dimanche?: boolean
          compte_feries?: boolean
          compte_samedi?: boolean
          created_at?: string
          description?: string | null
          jours_semaine?: Json
          libelle: string
          ordre?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          compte_dimanche?: boolean
          compte_feries?: boolean
          compte_samedi?: boolean
          created_at?: string
          description?: string | null
          jours_semaine?: Json
          libelle?: string
          ordre?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ref_type_mouvement: {
        Row: {
          actif: boolean
          code: string
          description: string | null
          est_definitif: boolean
          est_temporaire: boolean
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean
          code: string
          description?: string | null
          est_definitif?: boolean
          est_temporaire?: boolean
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean
          code?: string
          description?: string | null
          est_definitif?: boolean
          est_temporaire?: boolean
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_remuneration: {
        Row: {
          actif: boolean | null
          code: string
          libelle: string
          nature: string | null
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          libelle: string
          nature?: string | null
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          libelle?: string
          nature?: string | null
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_rubrique_paie: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          description: string | null
          libelle: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          description?: string | null
          libelle: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          description?: string | null
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      ref_type_temps: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_type_uo: {
        Row: {
          actif: boolean | null
          code: string
          couleur: string | null
          libelle: string
          niveau: number | null
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          couleur?: string | null
          libelle: string
          niveau?: number | null
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          couleur?: string | null
          libelle?: string
          niveau?: number | null
          ordre?: number | null
        }
        Relationships: []
      }
      ref_unite_duree_contrat: {
        Row: {
          actif: boolean | null
          code: string
          description: string | null
          libelle: string
          ordre: number | null
        }
        Insert: {
          actif?: boolean | null
          code: string
          description?: string | null
          libelle: string
          ordre?: number | null
        }
        Update: {
          actif?: boolean | null
          code?: string
          description?: string | null
          libelle?: string
          ordre?: number | null
        }
        Relationships: []
      }
      ref_ville: {
        Row: {
          actif: boolean | null
          code: string
          code_postal: string | null
          code_region: string
          libelle: string
        }
        Insert: {
          actif?: boolean | null
          code: string
          code_postal?: string | null
          code_region: string
          libelle: string
        }
        Update: {
          actif?: boolean | null
          code?: string
          code_postal?: string | null
          code_region?: string
          libelle?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_ville_code_region_fkey"
            columns: ["code_region"]
            isOneToOne: false
            referencedRelation: "ref_region"
            referencedColumns: ["code"]
          },
        ]
      }
      regle_calcul_specifique: {
        Row: {
          actif: boolean
          archive: boolean
          attribut_calcule: string
          code: string
          commentaire: string | null
          conditions: Json | null
          created_at: string
          created_by: string | null
          date_application: string | null
          date_debut_validite: string | null
          date_fin_validite: string | null
          decision_reference: string | null
          description: string | null
          expression: string
          id: string
          instructions_text: string | null
          libelle: string
          mode_edition: string
          updated_at: string
          updated_by: string | null
          variables_utilisees: Json | null
        }
        Insert: {
          actif?: boolean
          archive?: boolean
          attribut_calcule: string
          code: string
          commentaire?: string | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          date_application?: string | null
          date_debut_validite?: string | null
          date_fin_validite?: string | null
          decision_reference?: string | null
          description?: string | null
          expression: string
          id?: string
          instructions_text?: string | null
          libelle: string
          mode_edition?: string
          updated_at?: string
          updated_by?: string | null
          variables_utilisees?: Json | null
        }
        Update: {
          actif?: boolean
          archive?: boolean
          attribut_calcule?: string
          code?: string
          commentaire?: string | null
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          date_application?: string | null
          date_debut_validite?: string | null
          date_fin_validite?: string | null
          decision_reference?: string | null
          description?: string | null
          expression?: string
          id?: string
          instructions_text?: string | null
          libelle?: string
          mode_edition?: string
          updated_at?: string
          updated_by?: string | null
          variables_utilisees?: Json | null
        }
        Relationships: []
      }
      regle_specifique_instruction: {
        Row: {
          commentaire: string | null
          created_at: string
          est_actif: boolean
          id: string
          instruction: string
          label: string | null
          numero: number
          regle_id: string
          updated_at: string
        }
        Insert: {
          commentaire?: string | null
          created_at?: string
          est_actif?: boolean
          id?: string
          instruction: string
          label?: string | null
          numero: number
          regle_id: string
          updated_at?: string
        }
        Update: {
          commentaire?: string | null
          created_at?: string
          est_actif?: boolean
          id?: string
          instruction?: string
          label?: string | null
          numero?: number
          regle_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regle_specifique_instruction_regle_id_fkey"
            columns: ["regle_id"]
            isOneToOne: false
            referencedRelation: "regle_calcul_specifique"
            referencedColumns: ["id"]
          },
        ]
      }
      regles_cotisation: {
        Row: {
          a_traiter: boolean
          archive: boolean
          assiette_negative_acceptee: boolean
          assiette_negative_zero: boolean
          cle_bareme: string | null
          code: string
          code_assiette: string | null
          code_bareme: string | null
          created_at: string
          cumuler_plafonds_planchers: boolean
          date_application: string | null
          date_debut: string | null
          date_fin: string | null
          est_bareme: boolean
          id: string
          intitule: string
          intitule_complet: string | null
          max_patronale: number | null
          max_salariale: number | null
          min_patronale: number | null
          min_salariale: number | null
          mode_calcul: string | null
          nb_jours: string | null
          nb_paie: string | null
          prorata_temporis: boolean
          rapport: string | null
          regime: string | null
          taxe: number | null
          trentieme: string | null
          type_assiette: string | null
          type_bareme: string | null
          updated_at: string
        }
        Insert: {
          a_traiter?: boolean
          archive?: boolean
          assiette_negative_acceptee?: boolean
          assiette_negative_zero?: boolean
          cle_bareme?: string | null
          code: string
          code_assiette?: string | null
          code_bareme?: string | null
          created_at?: string
          cumuler_plafonds_planchers?: boolean
          date_application?: string | null
          date_debut?: string | null
          date_fin?: string | null
          est_bareme?: boolean
          id?: string
          intitule: string
          intitule_complet?: string | null
          max_patronale?: number | null
          max_salariale?: number | null
          min_patronale?: number | null
          min_salariale?: number | null
          mode_calcul?: string | null
          nb_jours?: string | null
          nb_paie?: string | null
          prorata_temporis?: boolean
          rapport?: string | null
          regime?: string | null
          taxe?: number | null
          trentieme?: string | null
          type_assiette?: string | null
          type_bareme?: string | null
          updated_at?: string
        }
        Update: {
          a_traiter?: boolean
          archive?: boolean
          assiette_negative_acceptee?: boolean
          assiette_negative_zero?: boolean
          cle_bareme?: string | null
          code?: string
          code_assiette?: string | null
          code_bareme?: string | null
          created_at?: string
          cumuler_plafonds_planchers?: boolean
          date_application?: string | null
          date_debut?: string | null
          date_fin?: string | null
          est_bareme?: boolean
          id?: string
          intitule?: string
          intitule_complet?: string | null
          max_patronale?: number | null
          max_salariale?: number | null
          min_patronale?: number | null
          min_salariale?: number | null
          mode_calcul?: string | null
          nb_jours?: string | null
          nb_paie?: string | null
          prorata_temporis?: boolean
          rapport?: string | null
          regime?: string | null
          taxe?: number | null
          trentieme?: string | null
          type_assiette?: string | null
          type_bareme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      regles_cotisation_rubriques: {
        Row: {
          created_at: string
          id: string
          ligne: string
          regle_id: string
          rubrique_patronale: string | null
          rubrique_salariale: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ligne: string
          regle_id: string
          rubrique_patronale?: string | null
          rubrique_salariale?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ligne?: string
          regle_id?: string
          rubrique_patronale?: string | null
          rubrique_salariale?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regles_cotisation_rubriques_regle_id_fkey"
            columns: ["regle_id"]
            isOneToOne: false
            referencedRelation: "regles_cotisation"
            referencedColumns: ["id"]
          },
        ]
      }
      regles_cotisation_tranches: {
        Row: {
          code_tranche: string
          created_at: string
          id: string
          plafond: number | null
          plancher: number | null
          regle_id: string
          taux_patronale: number | null
          taux_salariale: number | null
          updated_at: string
        }
        Insert: {
          code_tranche: string
          created_at?: string
          id?: string
          plafond?: number | null
          plancher?: number | null
          regle_id: string
          taux_patronale?: number | null
          taux_salariale?: number | null
          updated_at?: string
        }
        Update: {
          code_tranche?: string
          created_at?: string
          id?: string
          plafond?: number | null
          plancher?: number | null
          regle_id?: string
          taux_patronale?: number | null
          taux_salariale?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regles_cotisation_tranches_regle_id_fkey"
            columns: ["regle_id"]
            isOneToOne: false
            referencedRelation: "regles_cotisation"
            referencedColumns: ["id"]
          },
        ]
      }
      rubrique_paie: {
        Row: {
          archive: boolean
          code: string
          code_famille: string | null
          code_flux: string | null
          code_frequence: string | null
          code_regle: string | null
          code_type: string | null
          conditionnee: boolean
          created_at: string
          date_debut: string | null
          date_fin: string | null
          description: string | null
          frequence_calcul: string
          frequence_raz_cumuls: string
          libelle: string
          libelle_edition: string | null
          ordre_calcul: number | null
          pr_cumulee: boolean
          simulation: boolean
          traiter: boolean
          updated_at: string
          v_ajout: boolean
          v_batch: boolean
          v_externe: boolean
          v_forcage: boolean
          v_glissant: boolean
          v_historique: boolean
          v_regularisation: boolean
          zone_fixe_key: string | null
        }
        Insert: {
          archive?: boolean
          code: string
          code_famille?: string | null
          code_flux?: string | null
          code_frequence?: string | null
          code_regle?: string | null
          code_type?: string | null
          conditionnee?: boolean
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          description?: string | null
          frequence_calcul?: string
          frequence_raz_cumuls?: string
          libelle: string
          libelle_edition?: string | null
          ordre_calcul?: number | null
          pr_cumulee?: boolean
          simulation?: boolean
          traiter?: boolean
          updated_at?: string
          v_ajout?: boolean
          v_batch?: boolean
          v_externe?: boolean
          v_forcage?: boolean
          v_glissant?: boolean
          v_historique?: boolean
          v_regularisation?: boolean
          zone_fixe_key?: string | null
        }
        Update: {
          archive?: boolean
          code?: string
          code_famille?: string | null
          code_flux?: string | null
          code_frequence?: string | null
          code_regle?: string | null
          code_type?: string | null
          conditionnee?: boolean
          created_at?: string
          date_debut?: string | null
          date_fin?: string | null
          description?: string | null
          frequence_calcul?: string
          frequence_raz_cumuls?: string
          libelle?: string
          libelle_edition?: string | null
          ordre_calcul?: number | null
          pr_cumulee?: boolean
          simulation?: boolean
          traiter?: boolean
          updated_at?: string
          v_ajout?: boolean
          v_batch?: boolean
          v_externe?: boolean
          v_forcage?: boolean
          v_glissant?: boolean
          v_historique?: boolean
          v_regularisation?: boolean
          zone_fixe_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rubrique_paie_code_famille_fkey"
            columns: ["code_famille"]
            isOneToOne: false
            referencedRelation: "ref_famille_rubrique_paie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rubrique_paie_code_flux_fkey"
            columns: ["code_flux"]
            isOneToOne: false
            referencedRelation: "ref_flux_rubrique_paie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rubrique_paie_code_frequence_fkey"
            columns: ["code_frequence"]
            isOneToOne: false
            referencedRelation: "ref_frequence_rubrique_paie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rubrique_paie_code_type_fkey"
            columns: ["code_type"]
            isOneToOne: false
            referencedRelation: "ref_type_rubrique_paie"
            referencedColumns: ["code"]
          },
        ]
      }
      rubrique_paie_alimentation: {
        Row: {
          attribut_source: string | null
          code_attribut: string
          code_rubrique: string
          created_at: string
          donnee_source: string | null
          id: string
          nbr_paies_recuperer: number | null
          rubrique_source: string | null
          source_type: string
          table_source: string | null
          type_constante: string | null
          updated_at: string
          valeur_constante: string | null
        }
        Insert: {
          attribut_source?: string | null
          code_attribut: string
          code_rubrique: string
          created_at?: string
          donnee_source?: string | null
          id?: string
          nbr_paies_recuperer?: number | null
          rubrique_source?: string | null
          source_type?: string
          table_source?: string | null
          type_constante?: string | null
          updated_at?: string
          valeur_constante?: string | null
        }
        Update: {
          attribut_source?: string | null
          code_attribut?: string
          code_rubrique?: string
          created_at?: string
          donnee_source?: string | null
          id?: string
          nbr_paies_recuperer?: number | null
          rubrique_source?: string | null
          source_type?: string
          table_source?: string | null
          type_constante?: string | null
          updated_at?: string
          valeur_constante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rubrique_paie_alimentation_code_rubrique_fkey"
            columns: ["code_rubrique"]
            isOneToOne: false
            referencedRelation: "rubrique_paie"
            referencedColumns: ["code"]
          },
        ]
      }
      rubrique_paie_assiette: {
        Row: {
          code_assiette: string
          code_rubrique: string
          created_at: string
          id: string
          sens_assiette: string
          updated_at: string
        }
        Insert: {
          code_assiette: string
          code_rubrique: string
          created_at?: string
          id?: string
          sens_assiette?: string
          updated_at?: string
        }
        Update: {
          code_assiette?: string
          code_rubrique?: string
          created_at?: string
          id?: string
          sens_assiette?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rubrique_paie_assiette_code_assiette_fkey"
            columns: ["code_assiette"]
            isOneToOne: false
            referencedRelation: "rubrique_paie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rubrique_paie_assiette_code_rubrique_fkey"
            columns: ["code_rubrique"]
            isOneToOne: false
            referencedRelation: "rubrique_paie"
            referencedColumns: ["code"]
          },
        ]
      }
      rubrique_paie_imputation: {
        Row: {
          code_compte: string | null
          code_rubrique: string
          created_at: string
          id: string
          intitule_compte: string | null
          numero_imputation: number
          ref_imputation_id: string | null
          sens: string
          updated_at: string
        }
        Insert: {
          code_compte?: string | null
          code_rubrique: string
          created_at?: string
          id?: string
          intitule_compte?: string | null
          numero_imputation: number
          ref_imputation_id?: string | null
          sens: string
          updated_at?: string
        }
        Update: {
          code_compte?: string | null
          code_rubrique?: string
          created_at?: string
          id?: string
          intitule_compte?: string | null
          numero_imputation?: number
          ref_imputation_id?: string | null
          sens?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rubrique_paie_imputation_code_rubrique_fkey"
            columns: ["code_rubrique"]
            isOneToOne: false
            referencedRelation: "rubrique_paie"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rubrique_paie_imputation_ref_imputation_id_fkey"
            columns: ["ref_imputation_id"]
            isOneToOne: false
            referencedRelation: "ref_imputation_comptable"
            referencedColumns: ["id"]
          },
        ]
      }
      societe_affiliations: {
        Row: {
          code_type_affiliation: string
          created_at: string
          date_adhesion: string | null
          date_fin: string | null
          id: string
          numero_affiliation: string | null
          societe_id: string
          updated_at: string
        }
        Insert: {
          code_type_affiliation: string
          created_at?: string
          date_adhesion?: string | null
          date_fin?: string | null
          id?: string
          numero_affiliation?: string | null
          societe_id: string
          updated_at?: string
        }
        Update: {
          code_type_affiliation?: string
          created_at?: string
          date_adhesion?: string | null
          date_fin?: string | null
          id?: string
          numero_affiliation?: string | null
          societe_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "societe_affiliations_code_type_affiliation_fkey"
            columns: ["code_type_affiliation"]
            isOneToOne: false
            referencedRelation: "ref_type_affiliation"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "societe_affiliations_societe_id_fkey"
            columns: ["societe_id"]
            isOneToOne: false
            referencedRelation: "societes"
            referencedColumns: ["id"]
          },
        ]
      }
      societe_comptes_bancaires: {
        Row: {
          actif: boolean
          agence: string | null
          code_banque: string
          code_devise: string
          created_at: string
          date_ouverture: string | null
          iban: string | null
          id: string
          numero_compte: string
          societe_id: string
          swift: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          agence?: string | null
          code_banque: string
          code_devise?: string
          created_at?: string
          date_ouverture?: string | null
          iban?: string | null
          id?: string
          numero_compte: string
          societe_id: string
          swift?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          agence?: string | null
          code_banque?: string
          code_devise?: string
          created_at?: string
          date_ouverture?: string | null
          iban?: string | null
          id?: string
          numero_compte?: string
          societe_id?: string
          swift?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "societe_comptes_bancaires_societe_id_fkey"
            columns: ["societe_id"]
            isOneToOne: false
            referencedRelation: "societes"
            referencedColumns: ["id"]
          },
        ]
      }
      societes: {
        Row: {
          actif: boolean | null
          adresse: string | null
          capital_social: number | null
          code_convention_collective: string | null
          code_departement: string | null
          code_devise_capital: string | null
          code_naf: string | null
          code_pays: string | null
          code_postal: string | null
          code_region: string | null
          code_secteur_activite: string | null
          code_societe: string | null
          code_ville: string | null
          conseil_administration: string | null
          created_at: string
          date_creation_societe: string | null
          effectif: number | null
          email: string | null
          forme_juridique: string | null
          ice: string | null
          id: string
          identifiant_fiscal: string | null
          logo_path: string | null
          nom_commercial: string | null
          nom_gerant: string | null
          patente: string | null
          raison_sociale: string
          registre_commerce: string | null
          siret: string | null
          site_web: string | null
          telephone: string | null
          updated_at: string
          ville: string | null
        }
        Insert: {
          actif?: boolean | null
          adresse?: string | null
          capital_social?: number | null
          code_convention_collective?: string | null
          code_departement?: string | null
          code_devise_capital?: string | null
          code_naf?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_secteur_activite?: string | null
          code_societe?: string | null
          code_ville?: string | null
          conseil_administration?: string | null
          created_at?: string
          date_creation_societe?: string | null
          effectif?: number | null
          email?: string | null
          forme_juridique?: string | null
          ice?: string | null
          id?: string
          identifiant_fiscal?: string | null
          logo_path?: string | null
          nom_commercial?: string | null
          nom_gerant?: string | null
          patente?: string | null
          raison_sociale: string
          registre_commerce?: string | null
          siret?: string | null
          site_web?: string | null
          telephone?: string | null
          updated_at?: string
          ville?: string | null
        }
        Update: {
          actif?: boolean | null
          adresse?: string | null
          capital_social?: number | null
          code_convention_collective?: string | null
          code_departement?: string | null
          code_devise_capital?: string | null
          code_naf?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_secteur_activite?: string | null
          code_societe?: string | null
          code_ville?: string | null
          conseil_administration?: string | null
          created_at?: string
          date_creation_societe?: string | null
          effectif?: number | null
          email?: string | null
          forme_juridique?: string | null
          ice?: string | null
          id?: string
          identifiant_fiscal?: string | null
          logo_path?: string | null
          nom_commercial?: string | null
          nom_gerant?: string | null
          patente?: string | null
          raison_sociale?: string
          registre_commerce?: string | null
          siret?: string | null
          site_web?: string | null
          telephone?: string | null
          updated_at?: string
          ville?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "societes_code_convention_collective_fkey"
            columns: ["code_convention_collective"]
            isOneToOne: false
            referencedRelation: "ref_convention_collective"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "societes_code_departement_fkey"
            columns: ["code_departement"]
            isOneToOne: false
            referencedRelation: "ref_departement"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "societes_code_pays_fkey"
            columns: ["code_pays"]
            isOneToOne: false
            referencedRelation: "ref_pays"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "societes_code_region_fkey"
            columns: ["code_region"]
            isOneToOne: false
            referencedRelation: "ref_region"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "societes_code_secteur_activite_fkey"
            columns: ["code_secteur_activite"]
            isOneToOne: false
            referencedRelation: "ref_secteur_activite"
            referencedColumns: ["code"]
          },
        ]
      }
      unites_organisationnelles: {
        Row: {
          actif: boolean | null
          adresse_complete: string | null
          adresse_societe: boolean
          batiment: string | null
          bureau: string | null
          code: string | null
          code_pays: string | null
          code_postal: string | null
          code_region: string | null
          code_ville: string | null
          created_at: string
          email: string | null
          etablissement_id: string
          etage: string | null
          id: string
          libelle: string
          lieu: string | null
          niveau: number | null
          parent_id: string | null
          poste_responsable_code: string | null
          responsable_id: string | null
          responsable_temporaire: boolean | null
          telephone: string | null
          type_uo: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean | null
          adresse_complete?: string | null
          adresse_societe?: boolean
          batiment?: string | null
          bureau?: string | null
          code?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_ville?: string | null
          created_at?: string
          email?: string | null
          etablissement_id: string
          etage?: string | null
          id?: string
          libelle: string
          lieu?: string | null
          niveau?: number | null
          parent_id?: string | null
          poste_responsable_code?: string | null
          responsable_id?: string | null
          responsable_temporaire?: boolean | null
          telephone?: string | null
          type_uo?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean | null
          adresse_complete?: string | null
          adresse_societe?: boolean
          batiment?: string | null
          bureau?: string | null
          code?: string | null
          code_pays?: string | null
          code_postal?: string | null
          code_region?: string | null
          code_ville?: string | null
          created_at?: string
          email?: string | null
          etablissement_id?: string
          etage?: string | null
          id?: string
          libelle?: string
          lieu?: string | null
          niveau?: number | null
          parent_id?: string | null
          poste_responsable_code?: string | null
          responsable_id?: string | null
          responsable_temporaire?: boolean | null
          telephone?: string | null
          type_uo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unites_organisationnelles_etablissement_id_fkey"
            columns: ["etablissement_id"]
            isOneToOne: false
            referencedRelation: "etablissements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unites_organisationnelles_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unites_organisationnelles_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "collaborateurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uo_code_pays_fkey"
            columns: ["code_pays"]
            isOneToOne: false
            referencedRelation: "ref_pays"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "uo_code_region_fkey"
            columns: ["code_region"]
            isOneToOne: false
            referencedRelation: "ref_region"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "uo_code_ville_fkey"
            columns: ["code_ville"]
            isOneToOne: false
            referencedRelation: "ref_ville"
            referencedColumns: ["code"]
          },
        ]
      }
      uo_rattachement: {
        Row: {
          actif: boolean
          created_at: string
          date_debut: string
          date_decision: string | null
          date_fin: string | null
          enfant_uo_id: string
          id: string
          parent_uo_id: string
          reference_decision: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          date_debut?: string
          date_decision?: string | null
          date_fin?: string | null
          enfant_uo_id: string
          id?: string
          parent_uo_id: string
          reference_decision?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          date_debut?: string
          date_decision?: string | null
          date_fin?: string | null
          enfant_uo_id?: string
          id?: string
          parent_uo_id?: string
          reference_decision?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uo_rattachement_enfant_uo_id_fkey"
            columns: ["enfant_uo_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uo_rattachement_parent_uo_id_fkey"
            columns: ["parent_uo_id"]
            isOneToOne: false
            referencedRelation: "unites_organisationnelles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_theme_preferences: {
        Row: {
          accent_color: string | null
          background_color: string | null
          border_radius: string | null
          created_at: string
          font_family: string | null
          font_size_base: string | null
          font_size_heading: string | null
          id: string
          primary_color: string | null
          secondary_color: string | null
          sidebar_color: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accent_color?: string | null
          background_color?: string | null
          border_radius?: string | null
          created_at?: string
          font_family?: string | null
          font_size_base?: string | null
          font_size_heading?: string | null
          id?: string
          primary_color?: string | null
          secondary_color?: string | null
          sidebar_color?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accent_color?: string | null
          background_color?: string | null
          border_radius?: string | null
          created_at?: string
          font_family?: string | null
          font_size_base?: string | null
          font_size_heading?: string | null
          id?: string
          primary_color?: string | null
          secondary_color?: string | null
          sidebar_color?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_pending_departures: { Args: never; Returns: number }
      execute_depart_collaborateur: {
        Args: {
          p_collaborateur_id: string
          p_date_depart: string
          p_motif?: string
        }
        Returns: undefined
      }
      generate_droits_proportionnels: {
        Args: {
          p_collaborateur_id: string
          p_date_entree: string
          p_exercice?: number
        }
        Returns: number
      }
      get_or_create_default_etablissement: {
        Args: { p_libelle: string; p_societe_id: string }
        Returns: string
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recalculate_cong_solde: {
        Args: {
          p_code_type_conge: string
          p_collaborateur_id: string
          p_exercice: number
        }
        Returns: undefined
      }
      recalculate_societe_effectif: {
        Args: { p_societe_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "administrateur"
        | "gestionnaire_rh"
        | "gestionnaire_paie"
        | "manager"
        | "collaborateur"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "administrateur",
        "gestionnaire_rh",
        "gestionnaire_paie",
        "manager",
        "collaborateur",
      ],
    },
  },
} as const
