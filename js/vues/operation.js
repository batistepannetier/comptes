import * as db from '../db.js';
import { message, euros, lireMontant, montantPourSaisie, dateFr } from '../outils.js';

// ⚠️ Valeurs identiques aux CHECK de schema.sql
const STATUTS = [
  { valeur: 'realisee', libelle: 'Réalisée' },
  { valeur: 'prevue',   libelle: 'Prévue (estimation)' },
];
const MODE_SAISIE = 'formulaire';
const TYPE_EXTERNE = 'Externe';

// Conservés d'une saisie à l'autre
const memo = { compte: '', sens: '-1', statut: 'realisee', date: '' };

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const moisDe = iso => (iso || aujourdhui()).slice(0, 7);         // '2026-11-06' → '2026-11'
const moisFr = m => `${m.slice(5, 7)}/${m.slice(0, 4)}`;          // '2026-11' → '11/2026'
function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

// Arbre des rubriques actives + chemin complet de n'importe quelle rubrique
function chargerRubriques() {
  const toutes = db.lire('SELECT id, nom, parent_id, actif FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, { ...r, enfants: [] }]));
  const racines = [];
  for (const r of parId.values()) {
    if (!r.actif) continue;
    if (r.parent_id === null) racines.push(r);
    else parId.get(r.parent_id)?.enfants.push(r);
  }
  const trier = liste => {
    liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
    liste.forEach(r => trier(r.enfants));
  };
  trier(racines);
  const chemin = id => {
    const noms = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) noms.unshift(r.nom);
    return noms.join(' › ');
  };
  return { racines, parId, chemin };
}

export function afficherOperation(conteneur) {
  const { racines, parId, chemin } = chargerRubriques();
  const comptes = db.lire(
    'SELECT id, nom FROM comptes WHERE actif = 1 AND type <> ? ORDER BY ordre_affichage, nom', [TYPE_EXTERNE]);
  let rubriqueIds = []; // rubriques choisies : [N1, N2, N3]
  let lignes = [];      // répartition : { mois, texte }
  let compteur = 0;

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2>Nouvelle opération</h2>
      <form data-ref="form" class="form-operation" novalidate>
        <div class="grille">
          <label>Compte <select data-ref="compte"></select></label>
          <label>Sens
            <select data-ref="sens">
              <option value="-1">Dépense</option>
              <option value="1">Revenu</option>
            </select>
          </label>
          <label>Montant (€) <input data-ref="montant" type="text" inputmode="decimal" placeholder="45,90"></label>
          <label>Statut <select data-ref="statut"></select></label>
          <label>Date banque <input data-ref="date" type="date"></label>
        </div>

        <h3>Rubrique</h3>
        <div class="grille">
          <label>Niveau 1 <select data-ref="n1"></select></label>
          <label>Niveau 2 <select data-ref="n2"></select></label>
          <label>Niveau 3 <select data-ref="n3"></select></label>
          <label class="pleine">Détail
            <input data-ref="detail" type="text" maxlength="200" placeholder="Glace canal Saint-Martin">
          </label>
        </div>

        <h3>Répartition par mois</h3>
        <div data-ref="lignes"></div>
        <div class="pied-lignes">
          <button type="button" class="petit secondaire" data-ref="ajout-ligne">+ Ajouter un mois</button>
          <span data-ref="reste" class="reste" aria-live="polite"></span>
        </div>

        <div class="boutons-form">
          <button type="submit">Enregistrer</button>
          <button type="button" class="secondaire" data-ref="vider">Vider le formulaire</button>
        </div>
      </form>
    </section>
    <section>
      <h2>Dernières opérations saisies</h2>
      <p class="message" data-ref="vide" hidden>Aucune opération pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Date banque</th><th>Compte</th><th>Rubrique</th><th>Détail</th>
            <th class="num">Montant</th><th>Statut</th><th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="recentes"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // ---------- En-tête de l'opération ----------
  $('compte').append(option('', '— Choisir un compte —'), ...comptes.map(c => option(String(c.id), c.nom)));
  for (const s of STATUTS) $('statut').append(option(s.valeur, s.libelle));
  $('compte').value = comptes.some(c => String(c.id) === memo.compte) ? memo.compte
                    : comptes.length === 1 ? String(comptes[0].id) : '';
  $('sens').value = memo.sens;
  $('statut').value = memo.statut;
  $('date').value = memo.date || aujourdhui();
  if (comptes.length === 0) message("Aucun compte actif : crée d'abord un compte dans « Gérer les comptes ».", 'erreur');

  // Le mois d'imputation suit la date banque tant qu'on ne l'a pas modifié
  $('date').addEventListener('change', () => {
    for (const l of lignes) {
      if (!l.moisAuto) continue;
      l.mois = moisDe($('date').value);
      if (l.champMois) l.champMois.value = l.mois;
    }
  });

  // Avec un seul mois, la ligne reprend automatiquement le montant total
  $('montant').addEventListener('input', () => {
    if (lignes.length === 1 && lignes[0].auto) {
      lignes[0].texte = $('montant').value;
      lignes[0].champMontant.value = lignes[0].texte;
    }
    majReste();
  });

  // ---------- Rubriques en cascade ----------
  const selectsRubrique = [$('n1'), $('n2'), $('n3')];

  function majCascade() {
    let liste = racines;
    selectsRubrique.forEach((s, k) => {
      s.replaceChildren();
      if (!liste || liste.length === 0) {
        s.append(option('', '—'));
        s.disabled = true;
        liste = null;
        return;
      }
      s.disabled = false;
      s.append(option('', 'Choisir…'), ...liste.map(r => option(String(r.id), r.nom)));
      const choisi = liste.find(r => r.id === rubriqueIds[k]);
      s.value = choisi ? String(choisi.id) : '';
      liste = choisi ? choisi.enfants : null;
    });
  }
  selectsRubrique.forEach((s, k) => s.addEventListener('change', () => {
    rubriqueIds = rubriqueIds.slice(0, k);
    if (s.value) rubriqueIds.push(Number(s.value));
    majCascade();
  }));

  // Rubrique utilisable = la dernière choisie, si elle n'a pas de sous-rubrique
  function rubriqueFeuille() {
    const r = parId.get(rubriqueIds[rubriqueIds.length - 1]);
    return r && r.enfants.length === 0 ? r.id : null;
  }

  // ---------- Répartition par mois ----------
  const nouvelleLigne = () => ({
    cle: ++compteur, texte: '', mois: moisDe($('date').value), auto: true, moisAuto: true,
  });

  function blocLigne(l, i) {
    const bloc = creer('div', 'ligne');

    const mois = document.createElement('input');
    mois.type = 'month';
    mois.value = l.mois;
    mois.addEventListener('change', () => { l.mois = mois.value; l.moisAuto = false; });
    l.champMois = mois;

    const montant = document.createElement('input');
    montant.type = 'text';
    montant.inputMode = 'decimal';
    montant.placeholder = '0,00';
    montant.value = l.texte;
    montant.addEventListener('input', () => { l.texte = montant.value; l.auto = false; majReste(); });
    l.champMontant = montant;

    const actions = creer('div', 'actions-ligne');
    actions.append(
      bouton('Échelonner…', 'petit secondaire', () => echelonner(i)),
      bouton('Retirer', 'petit danger', () => retirer(i)));

    bloc.append(champ("Mois d'imputation", mois), champ('Montant (€)', montant), actions);
    return bloc;
  }

  function dessinerLignes() {
    $('lignes').replaceChildren(...lignes.map((l, i) => blocLigne(l, i)));
    majReste();
  }

  function majReste() {
    const zone = $('reste');
    const afficher = (texte, classe) => { zone.textContent = texte; zone.className = `reste ${classe}`; };
    const total = lireMontant($('montant').value);
    if (total === null) return afficher('Montant total invalide.', 'erreur');

    let somme = 0;
    for (const l of lignes) {
      const m = lireMontant(l.texte);
      if (m === null) return afficher('Un montant mensuel est invalide.', 'erreur');
      somme += m;
    }
    const ecart = total - somme;
    if (ecart === 0) afficher(total === 0 ? '' : '✓ Répartition complète', 'succes');
    else if (ecart > 0) afficher(`Reste à répartir : ${euros(ecart)}`, 'erreur');
    else afficher(`Répartition supérieure au montant de ${euros(-ecart)}`, 'erreur');
  }

  function echelonner(i) {
    const l = lignes[i];
    const total = lireMontant(l.texte);
    if (!total) return message(`Mois ${i + 1} : saisis d'abord le montant à échelonner.`, 'erreur');
    if (!/^\d{4}-\d{2}$/.test(l.mois)) return message(`Mois ${i + 1} : choisis le premier mois.`, 'erreur');

    const reponse = prompt(`Répartir ${euros(total)} sur combien de mois, à partir de ${moisFr(l.mois)} ?`, '12');
    if (reponse === null) return;
    const n = Number(reponse);
    if (!Number.isInteger(n) || n < 2 || n > 120) return message('Indique un nombre de mois entre 2 et 120.', 'erreur');

    const part = Math.trunc(total / n);
    const mensualites = Array.from({ length: n }, (_, k) => ({
      cle: ++compteur,
      auto: false,
      moisAuto: false,
      mois: decalerMois(l.mois, k),
      texte: montantPourSaisie(k === n - 1 ? total - part * (n - 1) : part), // les centimes sur le dernier mois
    }));
    lignes.splice(i, 1, ...mensualites);
    dessinerLignes();
    message(`Montant réparti sur ${n} mois.`, 'succes');
  }

  function retirer(i) {
    if (lignes.length === 1) lignes = [nouvelleLigne()];
    else lignes.splice(i, 1);
    dessinerLignes();
  }

  $('ajout-ligne').addEventListener('click', () => {
    const total = lireMontant($('montant').value) ?? 0;
    const somme = lignes.reduce((s, l) => s + (lireMontant(l.texte) ?? 0), 0);
    lignes.forEach(l => { l.auto = false; });
    const derniere = lignes[lignes.length - 1];
    const l = nouvelleLigne();
    l.auto = false;
    l.moisAuto = false;
    if (derniere && /^\d{4}-\d{2}$/.test(derniere.mois)) l.mois = decalerMois(derniere.mois, 1); // mois suivant
    if (total - somme > 0) l.texte = montantPourSaisie(total - somme); // pré-remplit le reste
    lignes.push(l);
    dessinerLignes();
  });

  $('vider').addEventListener('click', () => afficherOperation(conteneur));

  // ---------- Enregistrement ----------
  async function sauvegarder(texteSucces) {
    try {
      await db.enregistrer();
      message(texteSucces, 'succes');
    } catch (e) {
      message(`Modification faite, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
    afficherOperation(conteneur);
  }

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const compteId = Number($('compte').value);
    const sens = Number($('sens').value);
    const statut = $('statut').value;
    const date = $('date').value || null;
    const total = lireMontant($('montant').value);
    const rubrique = rubriqueFeuille();
    const detail = $('detail').value.trim() || null;

    if (!compteId) return message('Choisis un compte.', 'erreur');
    if (!total || total < 0) {
      return message('Saisis un montant positif (exemple : 45,90). Le sens est donné par « Dépense / Revenu ».', 'erreur');
    }
    if (statut === 'realisee' && !date) return message('La date banque est obligatoire pour une opération réalisée.', 'erreur');
    if (!rubrique) return message("Choisis la rubrique jusqu'au dernier niveau.", 'erreur');

    const aEnregistrer = [];
    let somme = 0;
    for (const [i, l] of lignes.entries()) {
      const montant = lireMontant(l.texte);
      if (!montant) return message(`Mois ${i + 1} : montant invalide.`, 'erreur');
      if (!/^\d{4}-\d{2}$/.test(l.mois)) return message(`Mois ${i + 1} : mois d'imputation manquant.`, 'erreur');
      somme += montant;
      aEnregistrer.push({ montant: sens * montant, mois: `${l.mois}-01` });
    }
    if (somme !== total) {
      return message(`La répartition (${euros(somme)}) ne correspond pas au montant (${euros(total)}).`, 'erreur');
    }

    const montantTotal = sens * total;
    try {
      db.executer('BEGIN');
      db.executer(
        `INSERT INTO operations (compte_id, statut, montant_total, montant_estime, date_banque, mode_saisie)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [compteId, statut, montantTotal, statut === 'prevue' ? montantTotal : null, date, MODE_SAISIE]);
      const id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
      // Même rubrique et même détail sur chaque mois
      aEnregistrer.forEach((l, i) => db.executer(
        `INSERT INTO lignes_operation (operation_id, rubrique_id, montant, libelle_detail, mois_imputation, ordre)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, rubrique, l.montant, detail, l.mois, i + 1]));
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Enregistrement impossible : ${e.message}`, 'erreur');
    }

    Object.assign(memo, { compte: String(compteId), sens: String(sens), statut, date: date ?? '' });
    const surMois = aEnregistrer.length > 1 ? `, sur ${aEnregistrer.length} mois` : '';
    await sauvegarder(`Opération de ${euros(montantTotal)} enregistrée${surMois}.`);
  });

  // ---------- Dernières opérations ----------
  const recentes = db.lire(`
    SELECT o.id, o.date_banque, o.statut, o.montant_total, c.nom AS compte,
           (SELECT COUNT(*) FROM lignes_operation l WHERE l.operation_id = o.id) AS nb_mois,
           (SELECT l.rubrique_id FROM lignes_operation l WHERE l.operation_id = o.id
             ORDER BY l.ordre LIMIT 1) AS rubrique_id,
           (SELECT l.libelle_detail FROM lignes_operation l WHERE l.operation_id = o.id
             ORDER BY l.ordre LIMIT 1) AS detail
    FROM operations o
    JOIN comptes c ON c.id = o.compte_id
    ORDER BY o.id DESC
    LIMIT 15`);
  $('vide').hidden = recentes.length > 0;

  async function supprimerOperation(o) {
    if (!confirm(`Supprimer l'opération de ${euros(o.montant_total)} du ${dateFr(o.date_banque)} (${o.compte}) ?` +
                 '\n\nCette action est irréversible.')) return;
    try {
      db.executer('DELETE FROM operations WHERE id = ?', [o.id]); // ses lignes suivent (ON DELETE CASCADE)
    } catch (e) {
      return message(`Suppression impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder('Opération supprimée.');
  }

  for (const o of recentes) {
    const tr = document.createElement('tr');
    let rubrique = o.rubrique_id ? chemin(o.rubrique_id) : '—';
    if (o.nb_mois > 1) rubrique += ` (sur ${o.nb_mois} mois)`;
    const statut = STATUTS.find(s => s.valeur === o.statut)?.libelle ?? o.statut;

    for (const valeur of [dateFr(o.date_banque), o.compte, rubrique, o.detail ?? '—']) {
      tr.append(creer('td', null, valeur));
    }
    tr.append(
      creer('td', o.montant_total < 0 ? 'num negatif' : 'num', euros(o.montant_total)),
      creer('td', null, statut));

    const tdActions = creer('td', 'col-actions');
    tdActions.append(bouton('Supprimer', 'petit danger', () => supprimerOperation(o)));
    tr.append(tdActions);
    $('recentes').append(tr);
  }

  // ---------- Démarrage ----------
  majCascade();
  lignes = [nouvelleLigne()];
  dessinerLignes();
  if (comptes.length > 0) $('montant').focus();
}