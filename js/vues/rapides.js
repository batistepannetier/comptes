import * as db from '../db.js';
import { message, euros, lireMontant, montantPourSaisie } from '../outils.js';

const TYPE_EXTERNE = 'Externe';
const ORGANISMES = ['Sécurité sociale', 'Mutuelle', 'Employeur (note de frais)'];

function creer(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}
function option(valeur, texte) {
  const o = document.createElement('option');
  o.value = valeur;
  o.textContent = texte;
  return o;
}
function champ(libelle, element) {
  const label = creer('label');
  label.append(document.createTextNode(libelle), element);
  return label;
}
function bouton(texte, classes, action) {
  const b = creer('button', classes, texte);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}

// Toutes les rubriques (actives ou non) avec leurs enfants
function chargerRubriques() {
  const toutes = db.lire('SELECT id, nom, parent_id, actif FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, { ...r, enfants: [] }]));
  for (const r of parId.values()) parId.get(r.parent_id)?.enfants.push(r);
  const tri = (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
  for (const r of parId.values()) r.enfants.sort(tri);
  const racines = [...parId.values()].filter(r => r.parent_id === null).sort(tri);
  const chemin = id => {
    const noms = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) noms.unshift(r.nom);
    return noms.join(' › ');
  };
  const ancetres = id => {
    const ids = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) ids.unshift(r.id);
    return ids;
  };
  return { racines, parId, chemin, ancetres };
}

export function afficherRapides(conteneur) {
  const { racines, parId, chemin, ancetres } = chargerRubriques();
  const comptes = db.lire(
    'SELECT id, nom, type, actif FROM comptes ORDER BY type = ?, ordre_affichage, nom', [TYPE_EXTERNE]);
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const actifs = comptes.filter(c => c.actif);
  const nomCompte = id => compteParId.get(id)?.nom ?? '?';
  const estExterne = id => compteParId.get(id)?.type === TYPE_EXTERNE;
  const libelleCompte = c => (c.type === TYPE_EXTERNE ? `${c.nom} (externe)` : c.nom);

  let enEdition = null; // id de la dépense rapide en cours de modification
  let rubriqueIds = []; // [N1, N2, N3]
  let rembs = [];       // { type, source, compteId, texte }

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2 data-ref="titre-form">Ajouter une dépense rapide</h2>
      <form data-ref="form" class="form-operation" novalidate>
        <div class="grille">
          <label>Compte (payé par) <select data-ref="compte"></select></label>
          <label>Montant (€, facultatif)
            <input data-ref="montant" type="text" inputmode="decimal" placeholder="Vide = à saisir">
          </label>
        </div>

        <h3>Rubrique</h3>
        <div class="grille">
          <label>Niveau 1 <select data-ref="n1"></select></label>
          <label>Niveau 2 <select data-ref="n2"></select></label>
          <label>Niveau 3 <select data-ref="n3"></select></label>
          <label class="pleine">Détail (sert de nom dans la liste)
            <input data-ref="detail" type="text" maxlength="200" placeholder="Courses Biocoop">
          </label>
        </div>

        <h3>Remboursements</h3>
        <p class="discret aide">
          Montant vide = le reste de la dépense (un seul remboursement peut avoir un montant vide).
        </p>
        <div data-ref="rembs"></div>
        <div class="pied-lignes">
          <button type="button" class="petit secondaire" data-ref="ajout-remb">+ Ajouter un remboursement</button>
        </div>
        <datalist id="liste-organismes-rapides"></datalist>

        <div class="boutons-form">
          <button type="submit" data-ref="valider">Ajouter</button>
          <button type="button" class="secondaire" data-ref="annuler" hidden>Annuler</button>
        </div>
      </form>
    </section>
    <section>
      <div class="entete-section">
        <h2>Dépenses rapides</h2>
        <a href="#/rapides/import" class="bouton-lien">📥 Importer depuis Excel</a>
      </div>
      <p class="message" data-ref="vide" hidden>Aucune dépense rapide pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Dépense</th><th>Compte</th><th>Rubrique</th><th class="num">Montant</th>
            <th>Remboursements</th><th>Statut</th><th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  $('compte').append(option('', '— Choisir un compte —'), ...actifs.map(c => option(String(c.id), libelleCompte(c))));
  conteneur.querySelector('#liste-organismes-rapides').append(...ORGANISMES.map(o => option(o, o)));

  async function sauvegarder(texte) {
    try {
      await db.enregistrer();
      message(texte, 'succes');
    } catch (e) {
      message(`Modification faite, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
    afficherRapides(conteneur);
  }

  // ---------- Données ----------
  const rapides = db.lire('SELECT id, compte_id, rubrique_id, detail, montant, actif FROM depenses_rapides');
  const tousRembs = db.lire(
    'SELECT depense_rapide_id, type, organisme, compte_id, montant FROM depenses_rapides_remb ORDER BY ordre, id');
  for (const r of rapides) {
    r.rembs = tousRembs.filter(x => x.depense_rapide_id === r.id);
    r.libelle = r.detail || chemin(r.rubrique_id);
  }
  rapides.sort((a, b) => b.actif - a.actif || a.libelle.localeCompare(b.libelle, 'fr', { sensitivity: 'base' }));
  $('vide').hidden = rapides.length > 0;

  const texteRembs = r => r.rembs.map(x =>
    `${x.type === 'organisme' ? x.organisme : nomCompte(x.compte_id)} ` +
    `${x.montant !== null ? euros(x.montant) : '(le reste)'}`).join(', ') || '—';

  // ---------- Liste ----------
  for (const r of rapides) {
    const tr = document.createElement('tr');
    if (!r.actif) tr.className = 'inactif';
    tr.append(
      creer('td', null, r.libelle),
      creer('td', null, nomCompte(r.compte_id)),
      creer('td', null, chemin(r.rubrique_id)),
      creer('td', 'num', r.montant !== null ? euros(r.montant) : 'À saisir'),
      creer('td', null, texteRembs(r)),
      creer('td', null, r.actif ? 'Active' : 'Inactive'));
    const tdActions = creer('td', 'col-actions');
    const actions = creer('div', 'actions-ligne');
    actions.append(
      bouton('Modifier', 'petit secondaire', () => modeModification(r)),
      bouton(r.actif ? 'Désactiver' : 'Réactiver', 'petit secondaire', () => basculerActif(r)),
      bouton('Supprimer', 'petit danger', () => supprimer(r)));
    tdActions.append(actions);
    tr.append(tdActions);
    $('liste').append(tr);
  }

  // ---------- Rubriques en cascade ----------
  const selectsRubrique = [$('n1'), $('n2'), $('n3')];
  const visibles = liste => liste.filter(r => r.actif || rubriqueIds.includes(r.id));

  function majCascade() {
    let liste = visibles(racines);
    selectsRubrique.forEach((s, k) => {
      s.replaceChildren();
      if (!liste || liste.length === 0) {
        s.append(option('', '—'));
        s.disabled = true;
        liste = null;
        return;
      }
      s.disabled = false;
      s.append(option('', 'Choisir…'),
               ...liste.map(r => option(String(r.id), r.actif ? r.nom : `${r.nom} (inactive)`)));
      const choisi = liste.find(r => r.id === rubriqueIds[k]);
      s.value = choisi ? String(choisi.id) : '';
      liste = choisi ? visibles(choisi.enfants) : null;
    });
  }
  selectsRubrique.forEach((s, k) => s.addEventListener('change', () => {
    rubriqueIds = rubriqueIds.slice(0, k);
    if (s.value) rubriqueIds.push(Number(s.value));
    majCascade();
  }));

  function rubriqueFeuille() {
    const r = parId.get(rubriqueIds[rubriqueIds.length - 1]);
    return r && !r.enfants.some(e => e.actif) ? r.id : null;
  }

  // ---------- Remboursements ----------
  function blocRemb(r, i) {
    const bloc = creer('div', 'ligne ligne-remb');

    const type = document.createElement('select');
    type.append(option('organisme', 'Organisme / employeur'), option('compte', 'Un autre compte'));
    type.value = r.type;
    type.addEventListener('change', () => { r.type = type.value; dessinerRembs(); });

    let source;
    if (r.type === 'organisme') {
      source = document.createElement('input');
      source.type = 'text';
      source.maxLength = 60;
      source.placeholder = 'Mutuelle';
      source.setAttribute('list', 'liste-organismes-rapides');
      source.value = r.source;
      source.addEventListener('input', () => { r.source = source.value; });
    } else {
      source = document.createElement('select');
      source.append(option('', '— Choisir —'));
      const payeur = Number($('compte').value);
      for (const c of actifs) if (c.id !== payeur) source.append(option(String(c.id), libelleCompte(c)));
      source.value = r.compteId;
      source.addEventListener('change', () => { r.compteId = source.value; });
    }

    const montant = document.createElement('input');
    montant.type = 'text';
    montant.inputMode = 'decimal';
    montant.placeholder = 'Vide = le reste';
    montant.value = r.texte;
    montant.addEventListener('input', () => { r.texte = montant.value; });

    bloc.append(
      champ('Remboursé par', type),
      champ(r.type === 'organisme' ? 'Organisme' : 'Compte', source),
      champ('Montant (€, facultatif)', montant),
      bouton('Retirer', 'petit danger', () => { rembs.splice(i, 1); dessinerRembs(); }));
    return bloc;
  }

  function dessinerRembs() {
    $('rembs').replaceChildren(...rembs.map((r, i) => blocRemb(r, i)));
  }

  $('ajout-remb').addEventListener('click', () => {
    const externe = estExterne(Number($('compte').value));
    rembs.push({ type: externe ? 'compte' : 'organisme', source: '', compteId: '', texte: '' });
    dessinerRembs();
  });
  $('compte').addEventListener('change', dessinerRembs); // le compte payeur est exclu des sources

  // ---------- Formulaire : ajout ou modification ----------
  function modeAjout() {
    enEdition = null;
    $('form').reset();
    rubriqueIds = [];
    rembs = [];
    majCascade();
    dessinerRembs();
    $('titre-form').textContent = 'Ajouter une dépense rapide';
    $('valider').textContent = 'Ajouter';
    $('annuler').hidden = true;
  }

  function modeModification(r) {
    enEdition = r.id;
    $('compte').value = compteParId.get(r.compte_id)?.actif ? String(r.compte_id) : '';
    $('montant').value = r.montant !== null ? montantPourSaisie(r.montant) : '';
    rubriqueIds = ancetres(r.rubrique_id);
    majCascade();
    $('detail').value = r.detail ?? '';
    rembs = r.rembs.map(x => ({
      type: x.type,
      source: x.organisme ?? '',
      compteId: x.compte_id ? String(x.compte_id) : '',
      texte: x.montant !== null ? montantPourSaisie(x.montant) : '',
    }));
    dessinerRembs();
    $('titre-form').textContent = `Modifier « ${r.libelle} »`;
    $('valider').textContent = 'Enregistrer';
    $('annuler').hidden = false;
    $('titre-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('annuler').addEventListener('click', modeAjout);

  async function basculerActif(r) {
    db.executer('UPDATE depenses_rapides SET actif = 1 - actif WHERE id = ?', [r.id]);
    await sauvegarder(`Dépense rapide « ${r.libelle} » ${r.actif ? 'désactivée' : 'réactivée'}.`);
  }

  async function supprimer(r) {
    if (!confirm(`Supprimer la dépense rapide « ${r.libelle} » ?\n\n` +
                 'Les opérations déjà saisies avec elle sont conservées.')) return;
    try {
      db.executer('BEGIN');
      db.executer('DELETE FROM depenses_rapides_remb WHERE depense_rapide_id = ?', [r.id]);
      db.executer('DELETE FROM depenses_rapides WHERE id = ?', [r.id]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Suppression impossible : ${e.message}`, 'erreur');
    }
    if (enEdition === r.id) enEdition = null;
    await sauvegarder(`Dépense rapide « ${r.libelle} » supprimée.`);
  }

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const compteId = Number($('compte').value);
    const texteMontant = $('montant').value.trim();
    const montant = texteMontant === '' ? null : lireMontant(texteMontant);
    const rubrique = rubriqueFeuille();
    const detail = $('detail').value.trim() || null;

    if (!compteId) return message('Choisis un compte.', 'erreur');
    if (montant !== null && (!montant || montant < 0)) {
      return message('Montant invalide (exemple : 45,90), ou laisse-le vide.', 'erreur');
    }
    if (!rubrique) return message("Choisis la rubrique jusqu'au dernier niveau.", 'erreur');

    const aEnregistrer = [];
    for (const [i, r] of rembs.entries()) {
      const m = r.texte.trim() === '' ? null : lireMontant(r.texte);
      if (m !== null && (!m || m < 0)) return message(`Remboursement ${i + 1} : montant invalide.`, 'erreur');
      if (r.type === 'organisme' && !r.source.trim()) {
        return message(`Remboursement ${i + 1} : indique l'organisme.`, 'erreur');
      }
      if (r.type === 'compte' && (!r.compteId || Number(r.compteId) === compteId)) {
        return message(`Remboursement ${i + 1} : choisis un autre compte que le compte payeur.`, 'erreur');
      }
      aEnregistrer.push({
        type: r.type,
        organisme: r.type === 'organisme' ? r.source.trim() : null,
        compte: r.type === 'compte' ? Number(r.compteId) : null,
        montant: m,
      });
    }
    if (aEnregistrer.filter(r => r.montant === null).length > 1) {
      return message('Un seul remboursement peut avoir un montant vide (= le reste).', 'erreur');
    }
    const fixe = aEnregistrer.reduce((s, r) => s + (r.montant ?? 0), 0);
    if (montant !== null && fixe > montant) {
      return message('Les remboursements dépassent le montant de la dépense.', 'erreur');
    }
    if (estExterne(compteId) && (aEnregistrer.length === 0 || aEnregistrer.some(r => r.type !== 'compte'))) {
      return message(`Une dépense avancée par ${nomCompte(compteId)} doit être prise en charge par tes comptes ` +
                     '(remboursement par « Un autre compte »).', 'erreur');
    }

    try {
      db.executer('BEGIN');
      let id = enEdition;
      if (id === null) {
        db.executer('INSERT INTO depenses_rapides (compte_id, rubrique_id, detail, montant) VALUES (?, ?, ?, ?)',
                    [compteId, rubrique, detail, montant]);
        id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
      } else {
        db.executer('UPDATE depenses_rapides SET compte_id = ?, rubrique_id = ?, detail = ?, montant = ? WHERE id = ?',
                    [compteId, rubrique, detail, montant, id]);
        db.executer('DELETE FROM depenses_rapides_remb WHERE depense_rapide_id = ?', [id]);
      }
      aEnregistrer.forEach((r, k) => db.executer(
        `INSERT INTO depenses_rapides_remb (depense_rapide_id, type, organisme, compte_id, montant, ordre)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, r.type, r.organisme, r.compte, r.montant, k + 1]));
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Enregistrement impossible : ${e.message}`, 'erreur');
    }
    const nom = detail || chemin(rubrique);
    await sauvegarder(`Dépense rapide « ${nom} » ${enEdition === null ? 'ajoutée' : 'modifiée'}.`);
  });

  modeAjout();
}