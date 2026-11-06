'use strict';

// État de l'application
const etat = { SQL: null, db: null, fichier: null };

const TYPES_FICHIER = [{
  description: 'Base de comptes SQLite',
  accept: { 'application/x-sqlite3': ['.db'] }
}];

const el = id => document.getElementById(id);

function message(texte, type = 'info') {
  const zone = el('message');
  zone.textContent = texte;
  zone.className = `message ${type}`;
}

function euros(centimes) {
  return (centimes / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

// SQLite ne mémorise pas ce réglage dans le fichier : on le réactive à chaque ouverture
function activerContraintes() {
  etat.db.run('PRAGMA foreign_keys = ON;');
}

function fermerBase() {
  if (etat.db) etat.db.close();
  etat.db = null;
  etat.fichier = null;
}

// ---------- Démarrage ----------
async function initialiser() {
  if (!('showOpenFilePicker' in window)) {
    message("Ce navigateur ne permet pas d'ouvrir un fichier local. Utilise Edge ou Chrome.", 'erreur');
    return;
  }
  try {
    etat.SQL = await initSqlJs({ locateFile: nom => `lib/${nom}` });
    el('btn-nouveau').disabled = false;
    el('btn-ouvrir').disabled = false;
    message('Prêt. Crée un nouveau fichier ou ouvre ton comptes.db.');
  } catch (e) {
    message(`Impossible de charger SQLite : ${e.message}`, 'erreur');
  }
}

// ---------- Enregistrement dans le fichier ----------
async function enregistrer() {
  const donnees = etat.db.export();
  activerContraintes(); // export() remet les PRAGMA à leur valeur par défaut
  const flux = await etat.fichier.createWritable();
  await flux.write(donnees);
  await flux.close();
}

// ---------- Créer un nouveau fichier ----------
async function creerFichier() {
  let db = null;
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: 'comptes.db', types: TYPES_FICHIER });

    const reponse = await fetch('sql/schema.sql');
    if (!reponse.ok) throw new Error('fichier sql/schema.sql introuvable');
    const schema = await reponse.text();

    db = new etat.SQL.Database();
    db.exec(schema);

    fermerBase();
    etat.db = db;
    etat.fichier = handle;
    activerContraintes();
    await enregistrer();

    message(`Fichier « ${handle.name} » créé avec toutes les tables.`, 'succes');
    afficher();
  } catch (e) {
    if (e.name === 'AbortError') return; // l'utilisateur a annulé
    if (db && db !== etat.db) db.close();
    message(`Création impossible : ${e.message}`, 'erreur');
  }
}

// ---------- Ouvrir un fichier existant ----------
async function ouvrirFichier() {
  let db = null;
  try {
    const [handle] = await window.showOpenFilePicker({ types: TYPES_FICHIER, multiple: false });
    const fichier = await handle.getFile();
    const octets = new Uint8Array(await fichier.arrayBuffer());

    db = new etat.SQL.Database(octets);
    const verif = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'comptes'");
    if (verif.length === 0) throw new Error('ce fichier ne contient pas la table « comptes »');

    fermerBase();
    etat.db = db;
    etat.fichier = handle;
    activerContraintes();

    message(`Fichier « ${handle.name} » ouvert.`, 'succes');
    afficher();
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (db && db !== etat.db) db.close();
    message(`Ouverture impossible : ${e.message}`, 'erreur');
  }
}

// ---------- Affichage ----------
function ajouterLigne(corps, valeurs) {
  const tr = document.createElement('tr');
  for (const valeur of valeurs) {
    const td = document.createElement('td');
    td.textContent = valeur; // jamais innerHTML
    tr.append(td);
  }
  corps.append(tr);
}

function afficher() {
  el('zone-base').hidden = false;
  el('nom-fichier').textContent = etat.fichier.name;

  // Tables et nombre de lignes
  const corpsTables = el('liste-tables');
  corpsTables.replaceChildren();
  const res = etat.db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const noms = res.length ? res[0].values.map(v => v[0]) : [];
  for (const nom of noms) {
    const nb = etat.db.exec(`SELECT COUNT(*) FROM "${nom}"`)[0].values[0][0];
    ajouterLigne(corpsTables, [nom, nb]);
  }

  // Comptes
  const corpsComptes = el('liste-comptes');
  corpsComptes.replaceChildren();
  const requete = etat.db.prepare(
    'SELECT nom, type, solde_initial, date_solde_initial FROM comptes ORDER BY ordre_affichage, nom'
  );
  let vide = true;
  while (requete.step()) {
    vide = false;
    const c = requete.getAsObject();
    ajouterLigne(corpsComptes, [c.nom, c.type, euros(c.solde_initial), c.date_solde_initial ?? '']);
  }
  requete.free();
  el('aucun-compte').hidden = !vide;
}

// ---------- Ajouter un compte ----------
async function ajouterCompte(evenement) {
  evenement.preventDefault();
  if (!etat.db) return;

  const nom = el('compte-nom').value.trim();
  const type = el('compte-type').value;
  const soldeTexte = el('compte-solde').value.replace(/\s/g, '').replace(',', '.');
  const date = el('compte-date').value || null;

  if (!nom) return message('Le nom du compte est obligatoire.', 'erreur');
  const solde = soldeTexte === '' ? 0 : Number(soldeTexte);
  if (!Number.isFinite(solde)) return message('Solde initial invalide (exemple : 1250,50).', 'erreur');

  try {
    etat.db.run(
      `INSERT INTO comptes (nom, type, solde_initial, date_solde_initial, ordre_affichage)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(ordre_affichage), 0) + 1 FROM comptes))`,
      [nom, type, Math.round(solde * 100), date]
    );
  } catch (e) {
    const texte = e.message.includes('UNIQUE') ? `Un compte « ${nom} » existe déjà.` : `Erreur : ${e.message}`;
    return message(texte, 'erreur');
  }

  try {
    await enregistrer();
    el('form-compte').reset();
    message(`Compte « ${nom} » ajouté et enregistré.`, 'succes');
  } catch (e) {
    message(`Compte ajouté, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
  }
  afficher();
}

// ---------- Branchements ----------
el('btn-nouveau').addEventListener('click', creerFichier);
el('btn-ouvrir').addEventListener('click', ouvrirFichier);
el('form-compte').addEventListener('submit', ajouterCompte);

initialiser();