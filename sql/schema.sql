PRAGMA foreign_keys = ON;

-- 1. COMPTES
CREATE TABLE comptes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                 TEXT    NOT NULL UNIQUE,
    type                TEXT    NOT NULL CHECK (type IN ('Courant', 'Epargne', 'Externe')),
    solde_initial       INTEGER NOT NULL DEFAULT 0,          -- centimes
    date_solde_initial  TEXT,                                -- 'AAAA-MM-JJ'
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
    ordre_affichage     INTEGER NOT NULL DEFAULT 0
    compte_rattachement_id  INTEGER REFERENCES comptes(id)   -- compte courant de rattachement (épargne)
);

-- 2. RUBRIQUES (hiérarchie N1 → N4)
CREATE TABLE rubriques (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nom        TEXT    NOT NULL,
    niveau     INTEGER NOT NULL CHECK (niveau BETWEEN 1 AND 4),
    parent_id  INTEGER REFERENCES rubriques(id),
    nature     TEXT    CHECK (nature IN ('depense', 'revenu', 'virement')),  -- renseignée au N1
    actif      INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
    UNIQUE (parent_id, nom),
    CHECK ((niveau = 1 AND parent_id IS NULL) OR (niveau > 1 AND parent_id IS NOT NULL))
);

-- 3. OPERATIONS (mouvement brut)
CREATE TABLE operations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    compte_id          INTEGER NOT NULL REFERENCES comptes(id),
    statut             TEXT    NOT NULL DEFAULT 'realisee' CHECK (statut IN ('prevue', 'realisee')),
    montant_total      INTEGER NOT NULL,                     -- centimes, négatif = sortie
    montant_estime     INTEGER,                              -- estimation initiale conservée
    date_banque        TEXT,                                 -- vide si 'prevue'
    libelle_bancaire   TEXT,
    mode_saisie        TEXT    NOT NULL CHECK (mode_saisie IN ('formulaire', 'rapide', 'import', 'annee_auto')),
    operation_liee_id  INTEGER REFERENCES operations(id) ON DELETE SET NULL,
    note               TEXT,
    date_creation      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    date_modif         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (statut = 'prevue' OR date_banque IS NOT NULL)
);

-- 4. LIGNES_OPERATION (ventilation rubrique × mois)
CREATE TABLE lignes_operation (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id     INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    rubrique_id      INTEGER NOT NULL REFERENCES rubriques(id),
    montant          INTEGER NOT NULL,                       -- centimes
    libelle_detail   TEXT,                                   -- le N4 libre
    mois_imputation  TEXT    NOT NULL CHECK (mois_imputation GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-01'),
    ordre            INTEGER NOT NULL DEFAULT 0
);

-- 5. MAPPING_IMPORT (règles de reconnaissance)
CREATE TABLE mapping_import (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern       TEXT    NOT NULL,
    type_pattern  TEXT    NOT NULL DEFAULT 'contient' CHECK (type_pattern IN ('contient', 'commence_par', 'regex')),
    compte_id     INTEGER REFERENCES comptes(id),            -- NULL = tous les comptes
    priorite      INTEGER NOT NULL DEFAULT 0,
    actif         INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1))
);

-- 6. MAPPING_IMPORT_LIGNES (rubriques proposées)
CREATE TABLE mapping_import_lignes (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    mapping_id             INTEGER NOT NULL REFERENCES mapping_import(id) ON DELETE CASCADE,
    rubrique_id            INTEGER NOT NULL REFERENCES rubriques(id),
    libelle_detail_defaut  TEXT,
    part_defaut            REAL CHECK (part_defaut IS NULL OR part_defaut BETWEEN 0 AND 100),  -- %
    ordre                  INTEGER NOT NULL DEFAULT 0
);

-- INDEX (accélèrent les recherches et analyses)
CREATE INDEX idx_rubriques_parent      ON rubriques(parent_id);
CREATE INDEX idx_operations_compte     ON operations(compte_id, date_banque);
CREATE INDEX idx_lignes_operation      ON lignes_operation(operation_id);
CREATE INDEX idx_lignes_mois           ON lignes_operation(mois_imputation);
CREATE INDEX idx_lignes_rubrique       ON lignes_operation(rubrique_id);
CREATE INDEX idx_mapping_lignes        ON mapping_import_lignes(mapping_id);

-- TRIGGER : met à jour date_modif automatiquement
CREATE TRIGGER trg_operations_modif
AFTER UPDATE ON operations
BEGIN
    UPDATE operations SET date_modif = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE INDEX idx_comptes_rattachement ON comptes(compte_rattachement_id);
PRAGMA user_version = 1;