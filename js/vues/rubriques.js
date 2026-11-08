import * as db from '../db.js';
import { message } from '../outils.js';

// ⚠️ Les valeurs doivent être identiques à celles du CHECK de schema.sql (colonne nature)
const NATURES = [
  { valeur: 'depense',  libelle: 'Dépense' },
  { valeur: 'revenu',   libelle: 'Revenu' },
  { valeur: 'virement', libelle: 'Virement' },
];
const libelleNature = v => NATURES.find(n => n.valeur === v)?.libelle ?? v ?? '—';
const NIVEAU_MAX = 3;

// Conservés entre deux affichages (après chaque enregistrement)
const ouverts = new Set();
let recherche = '';

// "Santé " → "sante" : comparaison sans accents ni majuscules
const normaliser = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Construit l'arbre N1 › N2 › N3 à partir de la table
function chargerArbre() {
  const lignes = db.lire('SELECT id, nom, niveau, parent_id, nature, actif FROM rubriques');
  const parId = new Map(lignes.map(r => [r.id, { ...r, enfants: [] }]));
  const racines = [];
  for (const r of parId.values()) {
    const parent = parId.get(r.parent_id);
    (parent ? parent.enfants : racines).push(r);
  }
  const completer = (liste, parent) => {
    liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
    for (const r of liste) {
      r.chemin = parent ? `${parent.chemin} › ${r.nom}` : r.nom;
      r.natureRacine = parent ? parent.natureRacine : r.nature; // nature héritée du N1
      completer(r.enfants, r);
    }
  };
  completer(racines, null);
  return { racines, parId };
}

const descendants = r => [r.id, ...r.enfants.flatMap(descendants)];

export function afficherRubriques(conteneur) {
  const { racines, parId } = chargerArbre();
  const noeuds = [];
  const aplatir = liste => liste.forEach(r => { noeuds.push(r); aplatir(r.enfants); });
  aplatir(racines);

  let enEdition = null; // rubrique en cours de modification

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2 data-ref="titre-form">Ajouter une rubrique</h2>
      <form data-ref="form" novalidate>
        <label>Rubrique parente
          <select data-ref="parent"></select>
        </label>
        <label>Nom
          <input data-ref="nom" type="text" required maxlength="60" placeholder="Santé">
        </label>
        <label data-ref="bloc-nature">Nature
          <select data-ref="nature"></select>
        </label>
        <div class="boutons-form">
          <button type="submit" data-ref="valider">Ajouter</button>
          <button type="button" class="secondaire" data-ref="annuler" hidden>Annuler</button>
        </div>
      </form>
    </section>
    <section>
      <h2>Rubriques</h2>
      <div class="barre-outils">
        <input data-ref="recherche" type="search" placeholder="Rechercher une rubrique…" aria-label="Rechercher une rubrique">
        <button type="button" class="petit secondaire" data-ref="tout-ouvrir">Tout déplier</button>
        <button type="button" class="petit secondaire" data-ref="tout-fermer">Tout replier</button>
      </div>
      <p class="message" data-ref="vide" hidden></p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Rubrique</th><th>Nature</th><th>Statut</th><th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  for (const n of NATURES) {
    const option = document.createElement('option');
    option.value = n.valeur;
    option.textContent = n.libelle;
    $('nature').append(option);
  }

  function bouton(texte, classes, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classes;
    b.textContent = texte;
    b.addEventListener('click', action);
    return b;
  }

  function cellule(texte) {
    const td = document.createElement('td');
    td.textContent = texte;
    return td;
  }

  // ---------- Arbre ----------
  function ligne(r, ouvert, terme) {
    const tr = document.createElement('tr');
    tr.className = `niveau-${r.niveau}${r.actif ? '' : ' inactif'}`;

    const arbre = document.createElement('div');
    arbre.className = 'arbre';
    arbre.style.paddingLeft = `${(r.niveau - 1) * 1.5}em`;

    if (r.enfants.length > 0) {
      const b = bouton(ouvert ? '▾' : '▸', 'deplier', () => {
        if (ouverts.has(r.id)) ouverts.delete(r.id); else ouverts.add(r.id);
        dessinerListe();
        $('liste').querySelector(`button.deplier[data-id="${r.id}"]`)?.focus();
      });
      b.dataset.id = String(r.id);
      b.setAttribute('aria-expanded', String(ouvert));
      b.setAttribute('aria-label', `${ouvert ? 'Replier' : 'Déplier'} ${r.nom}`);
      b.disabled = terme !== ''; // pendant une recherche, tout est déplié
      arbre.append(b);
    } else {
      const puce = document.createElement('span');
      puce.className = 'puce';
      puce.setAttribute('aria-hidden', 'true');
      arbre.append(puce);
    }

    const nom = document.createElement('span');
    nom.textContent = r.nom;
    arbre.append(nom);
    if (r.enfants.length > 0) {
      const nb = document.createElement('span');
      nb.className = 'nb';
      nb.textContent = `(${r.enfants.length})`;
      arbre.append(nb);
    }

    const tdNom = document.createElement('td');
    tdNom.append(arbre);

    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const actions = document.createElement('div');
    actions.className = 'actions-ligne';
    if (r.niveau < NIVEAU_MAX) {
      const ajout = bouton('+ Sous-rubrique', 'petit secondaire', () => modeAjout(r.id));
      ajout.disabled = !r.actif;
      actions.append(ajout);
    }
    actions.append(
      bouton('Modifier', 'petit secondaire', () => modeModification(r)),
      bouton(r.actif ? 'Désactiver' : 'Réactiver', 'petit secondaire', () => basculerActif(r)),
      bouton('Supprimer', 'petit danger', () => supprimer(r))
    );
    tdActions.append(actions);

    tr.append(
      tdNom,
      cellule(r.niveau === 1 ? libelleNature(r.nature) : ''),
      cellule(r.actif ? 'Active' : 'Inactive'),
      tdActions
    );
    return tr;
  }

  // Renvoie les lignes à afficher pour r et sa descendance
  function rendre(r, terme, ancetreCorrespond) {
    const correspond = ancetreCorrespond || normaliser(r.nom).includes(terme);
    const lignesEnfants = r.enfants.flatMap(e => rendre(e, terme, correspond));
    if (!correspond && lignesEnfants.length === 0) return [];
    const ouvert = terme !== '' || ouverts.has(r.id);
    return [ligne(r, ouvert, terme), ...(ouvert ? lignesEnfants : [])];
  }

  function dessinerListe() {
    const terme = normaliser(recherche);
    const lignes = racines.flatMap(r => rendre(r, terme, false));
    $('liste').replaceChildren(...lignes);

    const vide = $('vide');
    vide.hidden = lignes.length > 0;
    vide.textContent = racines.length === 0
      ? "Aucune rubrique pour l'instant. Commence par une rubrique de niveau 1 (Courses, Enfants…)."
      : 'Aucune rubrique ne correspond à la recherche.';
    $('tout-ouvrir').disabled = terme !== '';
    $('tout-fermer').disabled = terme !== '';
  }

  $('recherche').value = recherche;
  $('recherche').addEventListener('input', () => { recherche = $('recherche').value; dessinerListe(); });
  $('tout-ouvrir').addEventListener('click', () => {
    noeuds.filter(r => r.enfants.length > 0).forEach(r => ouverts.add(r.id));
    dessinerListe();
  });
  $('tout-fermer').addEventListener('click', () => { ouverts.clear(); dessinerListe(); });

  // ---------- Formulaire ----------
  function remplirParents(r = null, valeur = null) {
    const select = $('parent');
    select.replaceChildren();
    select.disabled = false;
    const ajouter = (val, texte) => {
      const option = document.createElement('option');
      option.value = val;
      option.textContent = texte;
      select.append(option);
    };

    if (r === null) {                 // ajout : n'importe quel N1 ou N2 actif
      ajouter('', '— Aucune (niveau 1) —');
      for (const p of noeuds) if (p.niveau < NIVEAU_MAX && p.actif) ajouter(String(p.id), p.chemin);
    } else if (r.niveau === 1) {      // un N1 reste un N1
      ajouter('', '— Aucune (niveau 1) —');
      select.disabled = true;
    } else {                          // déplacement possible, au même niveau
      for (const p of noeuds) {
        if (p.niveau === r.niveau - 1 && (p.actif || p.id === r.parent_id)) {
          ajouter(String(p.id), p.actif ? p.chemin : `${p.chemin} (inactive)`);
        }
      }
    }
    select.value = valeur === null ? '' : String(valeur);
  }

  function majNature() {
    $('bloc-nature').hidden = $('parent').value !== '';
  }
  $('parent').addEventListener('change', majNature);

  function modeAjout(parentId = null) {
    enEdition = null;
    $('form').reset();
    remplirParents(null, parentId);
    majNature();
    $('titre-form').textContent = parentId === null
      ? 'Ajouter une rubrique'
      : `Ajouter une sous-rubrique à « ${parId.get(parentId).chemin} »`;
    $('valider').textContent = 'Ajouter';
    $('annuler').hidden = parentId === null;
    if (parentId !== null) {
      $('titre-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('nom').focus({ preventScroll: true });
    }
  }

  function modeModification(r) {
    enEdition = r;
    $('nom').value = r.nom;
    remplirParents(r, r.parent_id);
    $('nature').value = r.nature ?? NATURES[0].valeur;
    majNature();
    $('titre-form').textContent = `Modifier « ${r.chemin} »`;
    $('valider').textContent = 'Enregistrer';
    $('annuler').hidden = false;
    $('titre-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('nom').focus({ preventScroll: true });
  }

  async function sauvegarder(texteSucces) {
    try {
      await db.enregistrer();
      message(texteSucces, 'succes');
    } catch (e) {
      message(`Modification faite, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
    afficherRubriques(conteneur); // redessine la vue avec les données à jour
  }

  // ---------- Activer / désactiver ----------
  async function basculerActif(r) {
    if (r.actif) {
      const ids = descendants(r);
      if (ids.length > 1 &&
          !confirm(`Désactiver « ${r.nom} » et ses ${ids.length - 1} sous-rubrique(s) ?`)) return;
      db.executer(`UPDATE rubriques SET actif = 0 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      await sauvegarder(`Rubrique « ${r.nom} » désactivée.`);
    } else {
      const parent = parId.get(r.parent_id);
      if (parent && !parent.actif) {
        return message(`Réactive d'abord la rubrique parente « ${parent.nom} ».`, 'erreur');
      }
      db.executer('UPDATE rubriques SET actif = 1 WHERE id = ?', [r.id]);
      await sauvegarder(`Rubrique « ${r.nom} » réactivée.`);
    }
  }

  // ---------- Suppression ----------
  async function supprimer(r) {
    if (r.enfants.length > 0) {
      return message(
        `Impossible de supprimer « ${r.nom} » : elle contient ${r.enfants.length} sous-rubrique(s). ` +
        "Supprime-les ou déplace-les d'abord.", 'erreur');
    }
    const [{ nb_lignes }] = db.lire(
      'SELECT COUNT(*) AS nb_lignes FROM lignes_operation WHERE rubrique_id = ?', [r.id]);
    if (nb_lignes > 0) {
      return message(
        `Impossible de supprimer « ${r.nom} » : ${nb_lignes} ligne(s) d'opération l'utilisent. ` +
        'Tu peux la désactiver à la place.', 'erreur');
    }

    const [{ nb_regles }] = db.lire(
      'SELECT COUNT(*) AS nb_regles FROM mapping_import_lignes WHERE rubrique_id = ?', [r.id]);
    let question = `Supprimer définitivement la rubrique « ${r.chemin} » ?`;
    if (nb_regles > 0) question += `\n\nElle est proposée par ${nb_regles} règle(s) d'import, qui ne la proposeront plus.`;
    question += '\n\nCette action est irréversible.';
    if (!confirm(question)) return;

    try {
      db.executer('BEGIN');
      db.executer('DELETE FROM mapping_import_lignes WHERE rubrique_id = ?', [r.id]);
      db.executer('DELETE FROM rubriques WHERE id = ?', [r.id]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Suppression impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder(`Rubrique « ${r.nom} » supprimée.`);
  }

  // ---------- Validation ----------
  $('annuler').addEventListener('click', () => modeAjout());

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const nom = $('nom').value.trim().replace(/\s+/g, ' ');
    if (!nom) return message('Le nom de la rubrique est obligatoire.', 'erreur');

    const parentId = $('parent').value === '' ? null : Number($('parent').value);
    const parent = parentId === null ? null : parId.get(parentId);
    const niveau = parent ? parent.niveau + 1 : 1;
    if (niveau > NIVEAU_MAX) return message(`Une rubrique ne peut pas dépasser le niveau ${NIVEAU_MAX}.`, 'erreur');
    const nature = parent ? null : $('nature').value;

    // Doublon : même nom au même endroit (SQLite ne le vérifie pas pour le niveau 1)
    const freres = parent ? parent.enfants : racines;
    if (freres.some(f => f.id !== enEdition?.id && normaliser(f.nom) === normaliser(nom))) {
      return message(`La rubrique « ${nom} » existe déjà à cet endroit.`, 'erreur');
    }

    try {
      if (enEdition === null) {
        db.executer('INSERT INTO rubriques (nom, niveau, parent_id, nature) VALUES (?, ?, ?, ?)',
                    [nom, niveau, parentId, nature]);
      } else {
        db.executer('UPDATE rubriques SET nom = ?, parent_id = ?, nature = ? WHERE id = ?',
                    [nom, parentId, nature, enEdition.id]);
      }
    } catch (e) {
      return message(`Erreur : ${e.message}`, 'erreur');
    }
    if (parentId !== null) ouverts.add(parentId); // pour voir tout de suite la rubrique ajoutée
    await sauvegarder(`Rubrique « ${nom} » ${enEdition === null ? 'ajoutée' : 'modifiée'} et enregistrée.`);
  });

  modeAjout();
  dessinerListe();
}