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
  async function supprimer(c) {
    // 1. Refus si des opérations sont rattachées au compte
    const [{ nb_operations }] = db.lire(
      'SELECT COUNT(*) AS nb_operations FROM operations WHERE compte_id = ?', [c.id]);
    if (nb_operations > 0) {
      return message(
        `Impossible de supprimer « ${c.nom} » : ${nb_operations} opération(s) y sont rattachées. ` +
        'Tu peux le désactiver à la place.', 'erreur');
    }

    // 2. Refus si des comptes (épargne ou externe) y sont rattachés
    const nb = nbRattaches(c.id);
    if (nb > 0) {
      return message(
        `Impossible de supprimer « ${c.nom} » : ${nb} compte(s) y sont rattachés (épargne ou externe). ` +
        "Rattache-les d'abord à un autre compte courant.", 'erreur');
    }

    // 2 bis. Refus si des dépenses rapides utilisent ce compte
    const [{ nb_rapides }] = db.lire(
      `SELECT (SELECT COUNT(*) FROM depenses_rapides WHERE compte_id = ?)
            + (SELECT COUNT(*) FROM depenses_rapides_remb WHERE compte_id = ?) AS nb_rapides`, [c.id, c.id]);
    if (nb_rapides > 0) {
      return message(
        `Impossible de supprimer « ${c.nom} » : ${nb_rapides} dépense(s) rapide(s) l'utilisent. ` +
        'Modifie-les ou supprime-les d\'abord.', 'erreur');
    }

    // 3. Confirmation (en signalant les règles d'import qui seront supprimées)
    const [{ nb_regles }] = db.lire(
      'SELECT COUNT(*) AS nb_regles FROM mapping_import WHERE compte_id = ?', [c.id]);
    let question = `Supprimer définitivement le compte « ${c.nom} » ?`;
    if (nb_regles > 0) {
      question += `\n\n${nb_regles} règle(s) d'import liée(s) à ce compte seront aussi supprimées.`;
    }
    question += '\n\nCette action est irréversible.';
    if (!confirm(question)) return;

    // 4. Suppression dans une transaction : tout ou rien
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
    const rattachement = AVEC_RATTACHEMENT.includes(type) && $('rattachement').value !== ''
      ? Number($('rattachement').value) : null;

    if (!nom) return message('Le nom du compte est obligatoire.', 'erreur');
    if (solde === null) return message('Solde initial invalide (exemple : 1250,50).', 'erreur');
    if (AVEC_RATTACHEMENT.includes(type) && rattachement === null) {
      return message(type === 'Externe'
        ? 'Choisis le compte pivot de ce compte externe (par exemple le Compte Commun).'
        : "Choisis le compte courant de rattachement (crée-en un d'abord si besoin).", 'erreur');
    }
    if (enEdition !== null && type !== 'Courant') {
      const nb = nbRattaches(enEdition);
      if (nb > 0) {
        return message(
          `Ce compte a ${nb} compte(s) rattaché(s) (épargne ou externe) : il doit rester de type Courant.`, 'erreur');
      }
    }

    try {
      if (enEdition === null) {
        db.executer(
          `INSERT INTO comptes (nom, type, solde_initial, date_solde_initial, compte_rattachement_id, ordre_affichage)
           VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(ordre_affichage), 0) + 1 FROM comptes))`,
          [nom, type, solde, date, rattachement]);
      } else {
        db.executer(
          `UPDATE comptes SET nom = ?, type = ?, solde_initial = ?, date_solde_initial = ?, compte_rattachement_id = ?
           WHERE id = ?`,
          [nom, type, solde, date, rattachement, enEdition]);
      }
    } catch (e) {
      return message(e.message.includes('UNIQUE') ? `Un compte « ${nom} » existe déjà.` : `Erreur : ${e.message}`, 'erreur');
    }
    await sauvegarder(`Compte « ${nom} » ${enEdition === null ? 'ajouté' : 'modifié'} et enregistré.`);
  });

  modeAjout(); // état initial du formulaire
}