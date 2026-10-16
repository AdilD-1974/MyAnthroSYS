"""
Schémas Pydantic 2 — Barèmes.

Inclut la validation métier :
  - codes uniques au sein des clés / sorties d'un même barème
  - exactement UNE sortie marquée par_defaut
  - mode PLAGE uniquement sur clés NUMERIQUE ou DATE
  - cohérence des valeurs JSONB avec les types/modes déclarés
"""
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# CLES
# ---------------------------------------------------------------------------
TypeCle = Literal["NUMERIQUE", "TEXTE", "DATE", "BOOLEEN"]
# EXACT = égalité stricte (tous types) ; PLAGE = intervalle {min, max} ;
# LT/LTE/GT/GTE = comparaison simple (<, <=, >, >=) à une valeur seuil unique —
# sigles confirmés depuis BaremeForm.tsx (type ModeCleExt local, RG-BAR-MODE-01),
# PAS "LE"/"GE" comme une première correction l'avait supposé à tort.
ModeCle = Literal["EXACT", "PLAGE", "LT", "LTE", "GT", "GTE"]


class BaremeCleBase(BaseModel):
    nom_technique: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    libelle: str = Field(..., min_length=1, max_length=200)
    type: TypeCle
    mode: ModeCle = "EXACT"
    ordre: int = 0

    @model_validator(mode="after")
    def _check_plage_compatible(self) -> "BaremeCleBase":
        # Comparer ("<", "≤", ">", "≥") ou définir une plage n'a de sens que
        # sur des valeurs ordonnables — NUMERIQUE ou DATE. EXACT reste seul
        # mode valable sur TEXTE/BOOLEEN.
        if self.mode != "EXACT" and self.type not in ("NUMERIQUE", "DATE"):
            raise ValueError(
                f"Mode {self.mode} incompatible avec le type {self.type}. "
                "Utilisez NUMERIQUE ou DATE (seul EXACT est possible sur TEXTE/BOOLEEN)."
            )
        return self


class BaremeCleRead(BaremeCleBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# SORTIES
# ---------------------------------------------------------------------------
TypeSortie = Literal["TAUX", "MONTANT", "NUMERIQUE", "TEXTE", "BOOLEEN"]


class BaremeSortieBase(BaseModel):
    nom_technique: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    libelle: str = Field(..., min_length=1, max_length=200)
    type: TypeSortie
    par_defaut: bool = False
    ordre: int = 0


class BaremeSortieRead(BaremeSortieBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# LIGNES
# ---------------------------------------------------------------------------
class BaremeLigneBase(BaseModel):
    ordre: int = 0
    valeurs_cles: dict[str, Any] = Field(default_factory=dict)
    valeurs_sorties: dict[str, Any] = Field(default_factory=dict)
    commentaire: str | None = None


class BaremeLigneRead(BaremeLigneBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# BAREME (en-tete + tout)
# ---------------------------------------------------------------------------
class BaremeBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=50, pattern=r"^[A-Z][A-Z0-9_]*$")
    libelle: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    date_debut_validite: date
    date_fin_validite: date | None = None
    reference_decision: str | None = Field(None, max_length=200)
    actif: bool = True
    # RG-MULTISOCIETE-03 (migration 057) : None = barème générique (visible
    # de toutes les sociétés), une valeur = surcharge propre à cette société.
    # Jamais modifiable via BaremeHeaderUpdate/PATCH (voir plus bas) -- un
    # barème ne change pas de portée après coup, il se recrée.
    societe_id: UUID | None = None

    @model_validator(mode="after")
    def _check_dates(self) -> "BaremeBase":
        if (
            self.date_fin_validite is not None
            and self.date_fin_validite < self.date_debut_validite
        ):
            raise ValueError("date_fin_validite ne peut pas être antérieure à date_debut_validite")
        return self


class BaremeCreate(BaremeBase):
    cles: list[BaremeCleBase] = Field(..., min_length=1)
    sorties: list[BaremeSortieBase] = Field(..., min_length=1)
    lignes: list[BaremeLigneBase] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_structure(self) -> "BaremeCreate":
        # Codes uniques
        cle_noms = [c.nom_technique for c in self.cles]
        if len(set(cle_noms)) != len(cle_noms):
            raise ValueError("Les noms techniques des clés doivent être uniques")

        sortie_noms = [s.nom_technique for s in self.sorties]
        if len(set(sortie_noms)) != len(sortie_noms):
            raise ValueError("Les noms techniques des sorties doivent être uniques")

        # Exactement une sortie par defaut
        nb_par_defaut = sum(1 for s in self.sorties if s.par_defaut)
        if nb_par_defaut != 1:
            raise ValueError(
                f"Il doit y avoir exactement 1 sortie marquée par_defaut "
                f"({nb_par_defaut} trouvée{'s' if nb_par_defaut > 1 else ''})"
            )

        # Cohérence des valeurs des lignes avec les clés/sorties
        cles_par_nom = {c.nom_technique: c for c in self.cles}
        sorties_par_nom = {s.nom_technique: s for s in self.sorties}

        for i, ligne in enumerate(self.lignes):
            # Toutes les clés doivent être renseignées
            for nom_cle, cle in cles_par_nom.items():
                if nom_cle not in ligne.valeurs_cles:
                    raise ValueError(
                        f"Ligne {i + 1} : valeur manquante pour la clé '{nom_cle}'"
                    )
                val = ligne.valeurs_cles[nom_cle]
                if cle.mode == "PLAGE":
                    if not isinstance(val, dict) or "min" not in val or "max" not in val:
                        raise ValueError(
                            f"Ligne {i + 1}, clé '{nom_cle}' (mode PLAGE) : "
                            f"valeur attendue {{min, max}}"
                        )

            # Aucune clé inconnue
            for nom_inconnu in set(ligne.valeurs_cles) - set(cles_par_nom):
                raise ValueError(
                    f"Ligne {i + 1} : clé inconnue '{nom_inconnu}' "
                    f"(clés déclarées : {sorted(cles_par_nom)})"
                )

            # Au moins la sortie par defaut doit être renseignée
            sortie_def = next(s.nom_technique for s in self.sorties if s.par_defaut)
            if sortie_def not in ligne.valeurs_sorties:
                raise ValueError(
                    f"Ligne {i + 1} : valeur manquante pour la sortie par defaut "
                    f"'{sortie_def}'"
                )

            # Aucune sortie inconnue
            for nom_inconnu in set(ligne.valeurs_sorties) - set(sorties_par_nom):
                raise ValueError(
                    f"Ligne {i + 1} : sortie inconnue '{nom_inconnu}' "
                    f"(sorties déclarées : {sorted(sorties_par_nom)})"
                )

        return self


class BaremeUpdate(BaremeCreate):
    """
    Mise à jour atomique : on remplace tout (en-tête + clés + sorties + lignes).
    Pour la mise à jour de l'en-tête seulement, voir BaremeHeaderUpdate.
    """


class BaremeHeaderUpdate(BaseModel):
    """Mise à jour partielle de l'en-tête uniquement."""

    code: str | None = Field(None, min_length=1, max_length=50, pattern=r"^[A-Z][A-Z0-9_]*$")
    libelle: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    date_debut_validite: date | None = None
    date_fin_validite: date | None = None
    reference_decision: str | None = Field(None, max_length=200)
    actif: bool | None = None


class BaremeRead(BaremeBase):
    id: UUID
    archive: bool
    created_at: datetime
    updated_at: datetime
    cles: list[BaremeCleRead]
    sorties: list[BaremeSortieRead]
    lignes: list[BaremeLigneRead]

    model_config = ConfigDict(from_attributes=True)


class BaremeListItem(BaremeBase):
    """Vue allégée pour la liste — sans cles/sorties/lignes."""

    id: UUID
    archive: bool
    nb_cles: int = 0
    nb_sorties: int = 0
    nb_lignes: int = 0
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
