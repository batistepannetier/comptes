import * as db from './db.js';
import { message } from './outils.js';
import { afficherAccueil } from './vues/accueil.js';
import { afficherComptes } from './vues/comptes.js';

// Adresse (#/...) → fonction qui dessine la vue
const ROUTES = {
  '': afficherAccueil,
  'comptes': afficherComptes,
};

const routeCourante = () => location.hash.replace(/^#\/?/, '');

function rafraichir() {
  document.getElementById('nom-fichier').textContent = db.nomFichier() ?? 'Aucun fichier ouvert';

  const vue = ROUTES[routeCourante()];
  if (!vue) { location.hash = '#/'; return; } // adresse inconnue → accueil

  const conteneur = document.getElementById('vue');
  conteneur.replaceChildren();

  if (!db.estOuverte()) {
    const section = document.createElement('section');
    section.textContent = 'Ouvre ton fichier comptes.db (ou crée un nouveau fichier) pour commencer.';
    conteneur.append(section);
    return;
  }
  vue(conteneur);
}

async function surNouveau() {
  if (db.estOuverte() && !confirm('Créer un nouveau fichier vide ? Le fichier actuel sera fermé.')) return;
  try {
    await db.creerFichier();
    message(`Fichier « ${db.nomFichier()} » créé avec toutes les tables.`, 'succes');
    rafraichir();
  } catch (e) {
    if (e.name !== 'AbortError') message(`Création impossible : ${e.message}`, 'erreur');
  }
}

async function surOuvrir() {
  try {
    await db.ouvrirFichier();
    message(`Fichier « ${db.nomFichier()} » ouvert.`, 'succes');
    rafraichir();
  } catch (e) {
    if (e.name !== 'AbortError') message(`Ouverture impossible : ${e.message}`, 'erreur');
  }
}

async function demarrer() {
  if (!('showOpenFilePicker' in window)) {
    message("Ce navigateur ne permet pas d'ouvrir un fichier local. Utilise Edge ou Chrome.", 'erreur');
    return;
  }
  try {
    await db.initialiserSQLite();
  } catch (e) {
    message(`Impossible de charger SQLite : ${e.message}`, 'erreur');
    return;
  }
  document.getElementById('btn-nouveau').disabled = false;
  document.getElementById('btn-ouvrir').disabled = false;
  message('Prêt.');
  rafraichir();
}

document.getElementById('btn-nouveau').addEventListener('click', surNouveau);
document.getElementById('btn-ouvrir').addEventListener('click', surOuvrir);
window.addEventListener('hashchange', () => { message(''); rafraichir(); });

demarrer();