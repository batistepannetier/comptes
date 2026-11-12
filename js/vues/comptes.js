import * as db from '../db.js';
import { message, lireMontant, montantPourSaisie } from '../outils.js';

// ⚠️ Les valeurs doivent être identiques à celles du CHECK de schema.sql
const TYPES = [
  { valeur: 'Courant', libelle: 'Courant' },
  { valeur: 'Epargne', libelle: 'Épargne' },
  { valeur: 'Externe', libelle: 'Externe' },
];
const libelleType = v => TYPES.find(t => t.valeur === v)?.libelle ?? v;
const AVEC_RATTACHEMENT = ['Epargne', 'Externe']; // épargne → compte courant ; externe → compte pivot

export function afficherComptes(conteneur) {
  let enEdition = null; // id du compte en cours de modification

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2 data-ref="titre-form">Ajouter un compte</h2>
      <form data-ref="form" novalidate>
        <label>Nom
          <input data-ref="nom" type="text" required maxlength="60" placeholder="Compte Chèque">
        </label>
        <label>Type
          <select data-ref="type"></select>
        </label>
        <label data-ref="bloc-rattachement" hidden><span data-ref="libelle-rattachement">Rattaché à</span>
          <select data-ref="rattachement"></select>
        </label>
        <label>Solde initial (€)
          <input data-ref="solde" type="text" inputmode="decimal" placeholder="1250,50">
        </label>
        <label>Date du solde
          <input data-ref="date" type="date">
        </label>
        <div class="boutons-form">
          <button type="submit" data-ref="valider">Ajouter</button>
          <button type="button" class="secondaire" data-ref="annuler" hidden>Annuler</button>
        </div>
      </form>
    </section>
    <section>
      <h2>Comptes</h2>
      <p class="message" data-ref="vide" hidden>Aucun compte pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Nom</th><th>Type</th><th>Rattaché à</th><th>Statut</th>
            <th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // Menu déroulant des types
  for (const t of TYPES) {
    const option = document.createElement('option');
    option.value = t.valeur;
    option.textContent = t.libelle;
    $('type').append(option);
  }

  // ---------- Données ----------
  // Tri : chaque compte courant suivi de ses comptes rattachés (épargne, externe)
  const comptes = db.lire(`
    SELECT c.id, c.nom, c.type, c.solde_initial, c.date_solde_initial, c.actif,
           c.compte_rattachement_id, p.nom AS rattachement_nom
    FROM comptes c
    LEFT JOIN comptes p ON p.id = c.compte_rattachement_id
    ORDER BY c.actif DESC,
             COALESCE(p.ordre_affichage, c.ordre_affichage),
             c.compte_rattachement_id IS NOT NULL,
             c.ordre_affichage, c.nom`);
  $('vide').hidden = comptes.length > 0;

  const nbRattaches = id =>
    db.lire('SELECT COUNT(*) AS nb FROM comptes WHERE compte_rattachement_id = ?', [id])[0].nb;

  // ---------- Liste ----------
  function bouton(texte, classes, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classes;
    b.textContent = texte;
    b.addEventListener('click', action);
    return b;
  }

  for (const c of comptes) {
    const tr = document.createElement('tr');
    if (!c.actif) tr.className = 'inactif';

    for (const valeur of [c.nom, libelleType(c.type), c.rattachement_nom ?? '—', c.actif ? 'Actif' : 'Inactif']) {
      const td = document.createElement('td');
      td.textContent = valeur;
      tr.append(td);
    }

    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const actions = document.createElement('div');
    actions.className = 'actions-ligne';
    actions.append(
      bouton('Modifier', 'petit secondaire', () => modeModification(c)),
      bouton(c.actif ? 'Désactiver' : 'Réactiver', 'petit secondaire', () => basculerActif(c)),
      bouton('Supprimer', 'petit danger', () => supprimer(c))
    );
    tdActions.append(actions);
    tr.append(tdActions);
    $('liste').append(tr);
  }

  // ---------- Rattachement ----------
  function remplirRattachements(idExclu = null, valeur = null) {
    const select = $('rattachement');
    select.replaceChildren();
    const vide = document.createElement('option');
    vide.value = '';
    vide.textContent = '— Choisir un compte courant —';
    select.append(vide);
    for (const c of comptes) {
      if (c.type !== 'Courant' || c.id === idExclu) continue;
      const option = document.createElement('option');
      option.value = String(c.id);
      option.textContent = c.actif ? c.nom : `${c.nom} (inactif)`;
      select.append(option);
    }
    select.value = valeur === null ? '' : String(valeur);
  }

  function majBlocRattachement() {
    const type = $('type').value;
    $('bloc-rattachement').hidden = !AVEC_RATTACHEMENT.includes(type);
    $('libelle-rattachement').textContent = type === 'Externe' ? 'Compte pivot' : 'Rattaché à';
  }
  $('type').addEventListener('change', majBlocRattachement);

  // ---------- Formulaire : ajout ou modification ----------
  function modeAjout() {
    enEdition = null;
    $('form').reset();
    remplirRattachements();
    majBlocRattachement();
    $('titre-form').textContent = 'Ajouter un compte';
    $('valider').textContent = 'Ajouter';
    $('annuler').hidden = true;
  }

  function modeModification(c) {
    enEdition = c.id;
    $('nom').value = c.nom;
    $('type').value = c.type;
    remplirRattachements(c.id, c.compte_rattachement_id);
    majBlocRattachement();
    $('solde').value = montantPourSaisie(c.solde_initial);
    $('date').value = c.date_solde_initial ?? '';
    $('titre-form').textContent = `Modifier « ${c.nom} »`;
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
    afficherComptes(conteneur); // redessine la vue avec les données à jour
  }

  async function basculerActif(c) {
    if (c.actif && c.type === 'Courant' && nbRattaches(c.id) > 0 &&
        !confirm(`Désactiver « ${c.nom} » ? Ses comptes rattachés (épargne, externe) apparaîtront dans « Non rattachés » sur l'accueil.`)) {
      return;
    }
    db.executer('UPDATE comptes SET actif = 1 - actif WHERE id = ?', [c.id]);
    await sauvegarder(`Compte « ${c.nom} » ${c.actif ? 'désactivé' : 'réactivé'}.`);
  }

  // ---------- Suppression ----------
  async function supprimer