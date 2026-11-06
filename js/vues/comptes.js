import * as db from '../db.js';
import { message, euros, lireMontant, montantPourSaisie, dateFr } from '../outils.js';

// ⚠️ Les valeurs doivent être identiques à celles du CHECK de schema.sql
const TYPES = [
  { valeur: 'Courant', libelle: 'Courant' },
  { valeur: 'Epargne', libelle: 'Épargne' },
  { valeur: 'Externe', libelle: 'Externe' },
];
const libelleType = v => TYPES.find(t => t.valeur === v)?.libelle ?? v;

export function afficherComptes(conteneur) {
  let enEdition = null; // id du compte en cours de modification

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2>Comptes</h2>
      <p class="message" data-ref="vide" hidden>Aucun compte pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Nom</th><th>Type</th><th>Solde initial</th><th>Date du solde</th><th>Statut</th><th>Actions</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
    </section>
    <section>
      <h2 data-ref="titre-form">Ajouter un compte</h2>
      <form data-ref="form" novalidate>
        <label>Nom
          <input data-ref="nom" type="text" required maxlength="60" placeholder="Compte Chèque">
        </label>
        <label>Type
          <select data-ref="type"></select>
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
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // Menu déroulant des types
  for (const t of TYPES) {
    const option = document.createElement('option');
    option.value = t.valeur;
    option.textContent = t.libelle;
    $('type').append(option);
  }

  // ---------- Liste ----------
  const comptes = db.lire(`
    SELECT id, nom, type, solde_initial, date_solde_initial, actif
    FROM comptes
    ORDER BY actif DESC, ordre_affichage, nom`);
  $('vide').hidden = comptes.length > 0;

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

    for (const valeur of [c.nom, libelleType(c.type), euros(c.solde_initial),
                          dateFr(c.date_solde_initial), c.actif ? 'Actif' : 'Inactif']) {
      const td = document.createElement('td');
      td.textContent = valeur;
      tr.append(td);
    }

    const tdActions = document.createElement('td');
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

  // ---------- Formulaire : ajout ou modification ----------
  function modeAjout() {
    enEdition = null;
    $('form').reset();
    $('titre-form').textContent = 'Ajouter un compte';
    $('valider').textContent = 'Ajouter';
    $('annuler').hidden = true;
  }

  function modeModification(c) {
    enEdition = c.id;
    $('nom').value = c.nom;
    $('type').value = c.type;
    $('solde').value = montantPourSaisie(c.solde_initial);
    $('date').value = c.date_solde_initial ?? '';
    $('titre-form').textContent = `Modifier « ${c.nom} »`;
    $('valider').textContent = 'Enregistrer';
    $('annuler').hidden = false;
    $('form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('nom').focus();
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
    db.executer('UPDATE comptes SET actif = 1 - actif WHERE id = ?', [c.id]);
    await sauvegarder(`Compte « ${c.nom} » ${c.actif ? 'désactivé' : 'réactivé'}.`);
  }

  // ---------- Suppression ----------
  async function supprimer(c) {
    // 1. Refus si des opérations sont rattachées au compte
    const [{ nb_operations }] = db.lire(
      'SELECT COUNT(*) AS nb_operations FROM operations WHERE compte_id = ?', [c.id]);
    if (nb_operations > 0) {
      return message(
        `Impossible de supprimer « ${c.nom} » : ${nb_operations} opération(s) y sont rattachées. ` +
        'Tu peux le désactiver à la place.', 'erreur');
    }

    // 2. Confirmation (en signalant les règles d'import qui seront supprimées)
    const [{ nb_regles }] = db.lire(
      'SELECT COUNT(*) AS nb_regles FROM mapping_import WHERE compte_id = ?', [c.id]);
    let question = `Supprimer définitivement le compte « ${c.nom} » ?`;
    if (nb_regles > 0) {
      question += `\n\n${nb_regles} règle(s) d'import liée(s) à ce compte seront aussi supprimées.`;
    }
    question += '\n\nCette action est irréversible.';
    if (!confirm(question)) return;

    // 3. Suppression dans une transaction : tout ou rien
    try {
      db.executer('BEGIN');
      db.executer('DELETE FROM mapping_import WHERE compte_id = ?', [c.id]); // leurs lignes suivent (ON DELETE CASCADE)
      db.executer('DELETE FROM comptes WHERE id = ?', [c.id]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Suppression impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder(`Compte « ${c.nom} » supprimé.`);
  }

  $('annuler').addEventListener('click', modeAjout);

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const nom = $('nom').value.trim();
    const type = $('type').value;
    const solde = lireMontant($('solde').value);
    const date = $('date').value || null;

    if (!nom) return message('Le nom du compte est obligatoire.', 'erreur');
    if (solde === null) return message('Solde initial invalide (exemple : 1250,50).', 'erreur');

    try {
      if (enEdition === null) {
        db.executer(
          `INSERT INTO comptes (nom, type, solde_initial, date_solde_initial, ordre_affichage)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(ordre_affichage), 0) + 1 FROM comptes))`,
          [nom, type, solde, date]);
      } else {
        db.executer(
          'UPDATE comptes SET nom = ?, type = ?, solde_initial = ?, date_solde_initial = ? WHERE id = ?',
          [nom, type, solde, date, enEdition]);
      }
    } catch (e) {
      return message(e.message.includes('UNIQUE') ? `Un compte « ${nom} » existe déjà.` : `Erreur : ${e.message}`, 'erreur');
    }
    await sauvegarder(`Compte « ${nom} » ${enEdition === null ? 'ajouté' : 'modifié'} et enregistré.`);
  });
}