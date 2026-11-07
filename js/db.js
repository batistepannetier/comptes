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
  // v0 → v1 : rattachement des comptes épargne à un compte courant
  base => {
    const colonnes = base.exec('PRAGMA table_info(comptes)')[0].values.map(v => v[1]);
    if (!colonnes.includes('compte_rattachement_id')) {
      base.run('ALTER TABLE comptes ADD COLUMN compte_rattachement_id INTEGER REFERENCES comptes(id)');
    }
    base.run('CREATE INDEX IF NOT EXISTS idx_comptes_rattachement ON comptes(compte_rattachement_id)');
  },
];

function migrer(base) {
  let version = base.exec('PRAGMA user_version')[0].values[0][0];
  while (version < MIGRATIONS.length) {
    MIGRATIONS[version](base);
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
