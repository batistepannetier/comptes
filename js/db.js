const TYPES_FICHIER = [{
  description: 'Base de comptes SQLite',
  accept: { 'application/x-sqlite3': ['.db'] }
}];

let SQL = null;     // moteur sql.js
let db = null;      // base ouverte
let handle = null;  // fichier sur le disque

// ---------- Migrations ----------
// MIGRATIONS[n] fait passer la base de la version n à la version n+1.
// Chaque migration doit pouvoir être rejouée sans erreur.
const MIGRATIONS = [
  // v0 → v1
  base => {
    const colonnes = base.exec('PRAGMA table_info(comptes)')[0].values.map(v => v[1]);
    if (!colonnes.includes('compte_rattachement_id')) {
      base.run('ALTER TABLE comptes ADD COLUMN compte_rattachement_id INTEGER REFERENCES comptes(id)');
    }
    base.run('CREATE INDEX IF NOT EXISTS idx_comptes_rattachement ON comptes(compte_rattachement_id)');
  },   // ← virgule obligatoire

  // v1 → v2
  base => {
    const colonnes = base.exec('PRAGMA table_info(operations)')[0].values.map(v => v[1]);
    if (!colonnes.includes('contrepartie_id')) {
      base.run('ALTER TABLE operations ADD COLUMN contrepartie_id INTEGER REFERENCES operations(id)');
    }
    base.run('CREATE INDEX IF NOT EXISTS idx_operations_contrepartie ON operations(contrepartie_id)');

    // Rattrapage des remboursements entre comptes déjà saisis
    const res = base.exec(`
      SELECT a.id, b.id
      FROM operations a
      JOIN operations p ON p.id = a.operation_liee_id
      JOIN operations b ON b.operation_liee_id = a.operation_liee_id
                       AND b.compte_id = p.compte_id
                       AND b.montant_total = -a.montant_total
                       AND b.libelle_bancaire LIKE 'Remboursement par %'
      WHERE a.compte_id <> p.compte_id
        AND a.contrepartie_id IS NULL AND b.contrepartie_id IS NULL`);
    const pris = new Set();
    for (const [a, b] of res[0]?.values ?? []) {
      if (pris.has(a) || pris.has(b)) continue;
      pris.add(a); pris.add(b);
      base.run('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [b, a]);
      base.run('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [a, b]);
    }
  },

  // v2 → v3
  base => {
    base.run(`CREATE TABLE IF NOT EXISTS virements (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      compte_debiteur_id   INTEGER NOT NULL REFERENCES comptes(id),
      compte_crediteur_id  INTEGER NOT NULL REFERENCES comptes(id),
      montant              INTEGER NOT NULL CHECK (montant >= 0),
      date_banque          TEXT    NOT NULL,
      date_creation        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')))`);
    const colonnes = base.exec('PRAGMA table_info(operations)')[0].values.map(v => v[1]);
    if (!colonnes.includes('virement_id')) {
      base.run('ALTER TABLE operations ADD COLUMN virement_id INTEGER REFERENCES virements(id)');
    }
    base.run('CREATE INDEX IF NOT EXISTS idx_operations_virement ON operations(virement_id)');
  },

  // v3 → v4 : dépenses rapides et leurs remboursements
  base => {
    base.run(`CREATE TABLE IF NOT EXISTS depenses_rapides (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      compte_id    INTEGER NOT NULL REFERENCES comptes(id),
      rubrique_id  INTEGER NOT NULL REFERENCES rubriques(id),
      detail       TEXT,
      montant      INTEGER CHECK (montant IS NULL OR montant > 0),
      actif        INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)))`);
    base.run(`CREATE TABLE IF NOT EXISTS depenses_rapides_remb (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      depense_rapide_id  INTEGER NOT NULL REFERENCES depenses_rapides(id) ON DELETE CASCADE,
      type               TEXT    NOT NULL CHECK (type IN ('organisme', 'compte')),
      organisme          TEXT,
      compte_id          INTEGER REFERENCES comptes(id),
      montant            INTEGER CHECK (montant IS NULL OR montant > 0),
      ordre              INTEGER NOT NULL DEFAULT 0)`);
    base.run('CREATE INDEX IF NOT EXISTS idx_rapides_remb ON depenses_rapides_remb(depense_rapide_id)');
  },

];

function migrer(base) {
  let version = base.exec('PRAGMA user_version')[0].values[0][0];
  while (version < MIGRATIONS.length) {
    const etape = MIGRATIONS[version]; // la migration qui fait passer à la version suivante
    etape(base);                        // on l'exécute sur la base
    version++;
    base.run(`PRAGMA user_version = ${version}`);
  }
}

export async function initialiserSQLite() {
  SQL = await initSqlJs({ locateFile: nom => `lib/${nom}` });
}

export const estOuverte = () => db !== null;
export const nomFichier = () => handle?.name ?? null;

// SQLite ne mémorise pas ce réglage dans le fichier : on le réactive à chaque fois
function activerContraintes() {
  db.run('PRAGMA foreign_keys = ON;');
}

function remplacer(nouvelleDb, nouveauHandle) {
  if (db) db.close();
  db = nouvelleDb;
  handle = nouveauHandle;
  activerContraintes();
}

export async function creerFichier() {
  const h = await window.showSaveFilePicker({ suggestedName: 'comptes.db', types: TYPES_FICHIER });
  const reponse = await fetch('sql/schema.sql');
  if (!reponse.ok) throw new Error('fichier sql/schema.sql introuvable');
  const schema = await reponse.text();

  const nouvelle = new SQL.Database();
  try {
    nouvelle.exec(schema);
    migrer(nouvelle); // sécurité si schema.sql n'est pas à jour
  } catch (e) {
    nouvelle.close();
    throw e;
  }
  remplacer(nouvelle, h);
  await enregistrer();
}

export async function ouvrirFichier() {
  const [h] = await window.showOpenFilePicker({ types: TYPES_FICHIER, multiple: false });
  const octets = new Uint8Array(await (await h.getFile()).arrayBuffer());

  const nouvelle = new SQL.Database(octets);
  try {
    const verif = nouvelle.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'comptes'");
    if (verif.length === 0) throw new Error('ce fichier ne contient pas la table « comptes »');
    migrer(nouvelle); // enregistrée dans le fichier à la prochaine modification
  } catch (e) {
    nouvelle.close();
    throw e;
  }
  remplacer(nouvelle, h);
}

export async function enregistrer() {
  const donnees = db.export();
  activerContraintes(); // export() remet les PRAGMA à leur valeur par défaut
  const flux = await handle.createWritable();
  await flux.write(donnees);
  await flux.close();
}

// Lecture : renvoie un tableau d'objets { colonne: valeur }
export function lire(sql, params = []) {
  const requete = db.prepare(sql);
  requete.bind(params);
  const lignes = [];
  while (requete.step()) lignes.push(requete.getAsObject());
  requete.free();
  return lignes;
}

// Écriture : INSERT, UPDATE, DELETE
export function executer(sql, params = []) {
  db.run(sql, params);
}
