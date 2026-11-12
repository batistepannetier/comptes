	import * as db from '../db.js';
import { message, euros, lireMontant, montantPourSaisie, dateFr } from '../outils.js';

// ⚠️ Valeurs identiques aux CHECK de schema.sql
const STATUTS = [
  { valeur: 'realisee', libelle: 'Réalisée' },
  { valeur: 'prevue',   libelle: 'Prévue (estimation)' },
];
const MODE_SAISIE = 'formulaire';
const TYPE_EXTERNE = 'Externe';
const ORGANISMES = ['Sécurité sociale', 'Mutuelle', 'Employeur (note de frais)'];

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

// Répartit un montant (centimes) au prorata de poids ; les centimes restants vont sur le dernier
function repartir(montant, poids) {
  const totalPoids = poids.reduce((s, p) => s + p, 0);
  const parts = poids.map(p => Math.trunc(montant * p / totalPoids));
  parts[parts.length - 1] += montant - parts.reduce((s, p) => s + p, 0);
  return parts;
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
  const tousComptes = db.lire(
    'SELECT id, nom, type FROM comptes WHERE actif = 1 ORDER BY ordre_affichage, nom');
  const comptes = tousComptes.filter(c => c.type !== TYPE_EXTERNE); // comptes qui peuvent payer
  const nomCompte = id => tousComptes.find(c => c.id === id)?.nom ?? '?';

  let rubriqueIds = []; // rubriques choisies : [N1, N2, N3]
  let lignes = [];      // répartition : { mois, texte }
  let rembs = [];       // remboursements : { type, source, compteId, texte, date }
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

        <div data-ref="bloc-remb">
          <h3>Remboursements attendus</h3>
          <p class="discret aide">
            Sécu, mutuelle, note de frais… ou un autre compte (par exemple le Compte Commun pour des courses communes).
            Sans date banque, le remboursement est enregistré comme prévu.
          </p>
          <div data-ref="rembs"></div>
          <div class="pied-lignes">
            <button type="button" class="petit secondaire" data-ref="ajout-remb">+ Ajouter un remboursement</button>
            <span data-ref="net" class="reste" aria-live="polite"></span>
          </div>
          <datalist id="liste-organismes"></datalist>
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
            <th class="num">Montant</th><th class="num">Remboursé</th><th>Statut</th><th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="recentes"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // ---------- En-tête de l'opération ----------
  $('compte').append(option('', '— Choisir un compte —'), ...comptes.map(c => option(String(c.id), c.nom)));
  for (const s of STATUTS) $('statut').append(option(s.valeur, s.libelle));
  conteneur.querySelector('#liste-organismes').append(...ORGANISMES.map(o => option(o, o)));
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

  // Une dépense prévue n'a pas encore de date banque : on vide et on grise le champ
  function majStatut() {
    const prevue = $('statut').value === 'prevue';
    $('date').disabled = prevue;
    if (prevue) {
      $('date').value = '';
    } else if (!$('date').value) {
      $('date').value = memo.date || aujourdhui();
      $('date').dispatchEvent(new Event('change')); // le mois d'imputation suit la date
    }
  }
  $('statut').addEventListener('change', majStatut);

  // Avec un seul mois, la ligne reprend automatiquement le montant total
  $('montant').addEventListener('input', () => {
    if (lignes.length === 1 && lignes[0].auto) {
      lignes[0].texte = $('montant').value;
      lignes[0].champMontant.value = lignes[0].texte;
    }
    majReste();
    majNet();
  });

  // Les remboursements n'existent que pour une dépense
  function majSens() {
    $('bloc-remb').hidden = $('sens').value !== '-1';
  }
  $('sens').addEventListener('change', majSens);
  $('compte').addEventListener('change', dessinerRembs); // le compte payeur est exclu des sources

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
      source.setAttribute('list', 'liste-organismes');
      source.value = r.source;
      source.addEventListener('input', () => { r.source = source.value; });
    } else {
      source = document.createElement('select');
      source.append(option('', '— Choisir —'));
      const payeur = Number($('compte').value);
      for (const c of tousComptes) {
        if (c.id !== payeur) source.append(option(String(c.id), c.nom));
      }
      source.value = r.compteId;
      source.addEventListener('change', () => { r.compteId = source.value; });
    }

    const montant = document.createElement('input');
    montant.type = 'text';
    montant.inputMode = 'decimal';
    montant.placeholder = '0,00';
    montant.value = r.texte;
    montant.addEventListener('input', () => { r.texte = montant.value; majNet(); });

    const date = document.createElement('input');
    date.type = 'date';
    date.value = r.date;
    date.addEventListener('change', () => { r.date = date.value; });

    bloc.append(
      champ('Remboursé par', type),
      champ(r.type === 'organisme' ? 'Organisme' : 'Compte', source),
      champ('Montant (€)', montant),
      champ('Date banque (facultatif)', date),
      bouton('Retirer', 'petit danger', () => { rembs.splice(i, 1); dessinerRembs(); }));
    return bloc;
  }

  function dessinerRembs() {
    $('rembs').replaceChildren(...rembs.map((r, i) => blocRemb(r, i)));
    majNet();
  }

  function majNet() {
    const zone = $('net');
    const afficher = (texte, classe) => { zone.textContent = texte; zone.className = `reste ${classe}`; };
    if (rembs.length === 0) return afficher('', '');
    const total = lireMontant($('montant').value) ?? 0;
    let somme = 0;
    for (const r of rembs) {
      const m = lireMontant(r.texte);
      if (m === null) return afficher('Un montant de remboursement est invalide.', 'erreur');
      somme += m;
    }
    if (somme > total) afficher(`Remboursements supérieurs à la dépense de ${euros(somme - total)}`, 'erreur');
    else afficher(`Reste à ta charge : ${euros(total - somme)}`, 'succes');
  }

  $('ajout-remb').addEventListener('click', () => {
    const total = lireMontant($('montant').value) ?? 0;
    const deja = rembs.reduce((s, r) => s + (lireMontant(r.texte) ?? 0), 0);
    rembs.push({
      cle: ++compteur, type: 'organisme', source: '', compteId: '', date: '',
      texte: total - deja > 0 ? montantPourSaisie(total - deja) : '',
    });
    dessinerRembs();
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

  // Crée une opération et ses lignes ; renvoie son id
  function inserer({ compteId, statut, montant, date, libelle, lieeA, rubrique, detail, lignesMois }) {
    db.executer(
      `INSERT INTO operations (compte_id, statut, montant_total, montant_estime, date_banque,
                               libelle_bancaire, mode_saisie, operation_liee_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [compteId, statut, montant, statut === 'prevue' ? montant : null, date, libelle, MODE_SAISIE, lieeA]);
    const id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
    lignesMois.forEach((l, i) => db.executer(
      `INSERT INTO lignes_operation (operation_id, rubrique_id, montant, libelle_detail, mois_imputation, ordre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, rubrique, l.montant, detail, l.mois, i + 1]));
    return id;
  }

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const compteId = Number($('compte').value);
    const sens = Number($('sens').value);
    const statut = $('statut').value;
    const date = statut === 'prevue' ? null : ($('date').value || null);
    const total = lireMontant($('montant').value);
    const rubrique = rubriqueFeuille();
    const detail = $('detail').value.trim() || null;

    if (!compteId) return message('Choisis un compte.', 'erreur');
    if (!total || total < 0) {
      return message('Saisis un montant positif (exemple : 45,90). Le sens est donné par « Dépense / Revenu ».', 'erreur');
    }
    if (statut === 'realisee' && !date) return message('La date banque est obligatoire pour une opération réalisée.', 'erreur');
    if (!rubrique) return message("Choisis la rubrique jusqu'au dernier niveau.", 'erreur');

    // Répartition par mois
    const mensuel = [];
    let somme = 0;
    for (const [i, l] of lignes.entries()) {
      const montant = lireMontant(l.texte);
      if (!montant) return message(`Mois ${i + 1} : montant invalide.`, 'erreur');
      if (!/^\d{4}-\d{2}$/.test(l.mois)) return message(`Mois ${i + 1} : mois d'imputation manquant.`, 'erreur');
      somme += montant;
      mensuel.push({ montant, mois: `${l.mois}-01` });
    }
    if (somme !== total) {
      return message(`La répartition (${euros(somme)}) ne correspond pas au montant (${euros(total)}).`, 'erreur');
    }

    // Remboursements (dépense uniquement)
    const aRembourser = [];
    if (sens === -1) {
      let totalRemb = 0;
      for (const [i, r] of rembs.entries()) {
        const montant = lireMontant(r.texte);
        if (!montant || montant < 0) return message(`Remboursement ${i + 1} : montant invalide.`, 'erreur');
        if (r.type === 'organisme' && !r.source.trim()) {
          return message(`Remboursement ${i + 1} : indique l'organisme.`, 'erreur');
        }
        if (r.type === 'compte' && (!r.compteId || Number(r.compteId) === compteId)) {
          return message(`Remboursement ${i + 1} : choisis un autre compte que le compte payeur.`, 'erreur');
        }
        totalRemb += montant;
        aRembourser.push({ ...r, montant, statut: r.date ? 'realisee' : 'prevue', date: r.date || null });
      }
      if (totalRemb > total) return message('Les remboursements dépassent le montant de la dépense.', 'erreur');
    }

    // Les remboursements sont imputés sur les mêmes mois que la dépense, au prorata
    const poids = mensuel.map(l => l.montant);
    const lignesRemb = (montant, signe) =>
      repartir(montant, poids)
        .map((p, k) => ({ montant: signe * p, mois: mensuel[k].mois }))
        .filter(l => l.montant !== 0);

    try {
      db.executer('BEGIN');
      const id = inserer({
        compteId, statut, montant: sens * total, date, libelle: null, lieeA: null, rubrique, detail,
        lignesMois: mensuel.map(l => ({ montant: sens * l.montant, mois: l.mois })),
      });

      for (const r of aRembourser) {
        const commun = { statut: r.statut, date: r.date, lieeA: id, rubrique, detail };
        if (r.type === 'organisme') {
          // L'organisme rembourse le compte payeur
          inserer({ ...commun, compteId, montant: r.montant, libelle: `Remboursement ${r.source.trim()}`,
                    lignesMois: lignesRemb(r.montant, 1) });
        } else {
          // Le compte source prend la dépense à sa charge…
          const source = Number(r.compteId);
          const idSource = inserer({ ...commun, compteId: source, montant: -r.montant,
                    libelle: `Remboursement à ${nomCompte(compteId)}`, lignesMois: lignesRemb(r.montant, -1) });
          // … et le compte payeur est remboursé
          const idPayeur = inserer({ ...commun, compteId, montant: r.montant,
                    libelle: `Remboursement par ${nomCompte(source)}`, lignesMois: lignesRemb(r.montant, 1) });
          db.executer('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [idPayeur, idSource]);
          db.executer('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [idSource, idPayeur]);
        }      }
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Enregistrement impossible : ${e.message}`, 'erreur');
    }

    Object.assign(memo, { compte: String(compteId), sens: String(sens), statut, date: date ?? memo.date });
    const surMois = mensuel.length > 1 ? `, sur ${mensuel.length} mois` : '';
    const avecRemb = aRembourser.length > 0 ? `, avec ${aRembourser.length} remboursement(s)` : '';
    await sauvegarder(`Opération de ${euros(sens * total)} enregistrée${surMois}${avecRemb}.`);
  });

  // ---------- Dernières opérations (hors remboursements) ----------
  const recentes = db.lire(`
    SELECT o.id, o.date_banque, o.statut, o.montant_total, o.compte_id, c.nom AS compte,
           (SELECT COUNT(*) FROM lignes_operation l WHERE l.operation_id = o.id) AS nb_mois,
           (SELECT l.rubrique_id FROM lignes_operation l WHERE l.operation_id = o.id
             ORDER BY l.ordre LIMIT 1) AS rubrique_id,
           (SELECT l.libelle_detail FROM lignes_operation l WHERE l.operation_id = o.id
             ORDER BY l.ordre LIMIT 1) AS detail,
           (SELECT COUNT(*) FROM operations r WHERE r.operation_liee_id = o.id) AS nb_liees,
           (SELECT SUM(r.montant_total) FROM operations r
             WHERE r.operation_liee_id = o.id AND r.compte_id = o.compte_id) AS rembourse
    FROM operations o
    JOIN comptes c ON c.id = o.compte_id
    WHERE o.operation_liee_id IS NULL
    ORDER BY o.id DESC
    LIMIT 15`);
  $('vide').hidden = recentes.length > 0;

  async function supprimerOperation(o) {
    let question = `Supprimer l'opération de ${euros(o.montant_total)} du ${dateFr(o.date_banque)} (${o.compte}) ?`;
    if (o.nb_liees > 0) question += `\n\nSes ${o.nb_liees} opération(s) de remboursement seront aussi supprimées.`;
    if (!confirm(`${question}\n\nCette action est irréversible.`)) return;
    try {
      db.executer('BEGIN');
      db.executer('DELETE FROM operations WHERE operation_liee_id = ?', [o.id]);
      db.executer('DELETE FROM operations WHERE id = ?', [o.id]); // les lignes suivent (ON DELETE CASCADE)
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Suppression impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder('Opération supprimée.');
  }

  // Remboursements liés aux dépenses affichées, regroupés par dépense
  const ids = recentes.map(o => o.id);
  const liees = new Map();
  if (ids.length > 0) {
    const lignesLiees = db.lire(`
      SELECT r.id, r.operation_liee_id, r.date_banque, r.statut, r.montant_total, r.libelle_bancaire,
             c.nom AS compte
      FROM operations r
      JOIN comptes c ON c.id = r.compte_id
      WHERE r.operation_liee_id IN (${ids.map(() => '?').join(',')})
      ORDER BY r.id`, ids);
    for (const r of lignesLiees) {
      if (!liees.has(r.operation_liee_id)) liees.set(r.operation_liee_id, []);
      liees.get(r.operation_liee_id).push(r);
    }
  }
  const libelleStatut = v => STATUTS.find(s => s.valeur === v)?.libelle ?? v;

  for (const o of recentes) {
    const tr = document.createElement('tr');
    let rubrique = o.rubrique_id ? chemin(o.rubrique_id) : '—';
    if (o.nb_mois > 1) rubrique += ` (sur ${o.nb_mois} mois)`;

    for (const valeur of [dateFr(o.date_banque), o.compte, rubrique, o.detail ?? '—']) {
      tr.append(creer('td', null, valeur));
    }
    tr.append(
      creer('td', o.montant_total < 0 ? 'num negatif' : 'num', euros(o.montant_total)),
      creer('td', 'num', o.rembourse ? euros(o.rembourse) : '—'),
      creer('td', null, libelleStatut(o.statut)));

    const tdActions = creer('td', 'col-actions');
    tdActions.append(bouton('Supprimer', 'petit danger', () => supprimerOperation(o)));
    tr.append(tdActions);
    $('recentes').append(tr);

    // Lignes secondaires : un remboursement par ligne
    for (const r of liees.get(o.id) ?? []) {
      const sous = document.createElement('tr');
      sous.className = 'sous-ligne';
      sous.append(
        creer('td', null, dateFr(r.date_banque)),
        creer('td', null, r.compte),
        creer('td', 'libelle-remb', `↳ ${r.libelle_bancaire ?? 'Remboursement'}`),
        creer('td', null, ''),
        creer('td', r.montant_total < 0 ? 'num negatif' : 'num', euros(r.montant_total)),
        creer('td', null, ''),
        creer('td', null, libelleStatut(r.statut)),
        creer('td', 'col-actions', ''));
      $('recentes').append(sous);
    }
  }

  // ---------- Démarrage ----------
  majCascade();
  majSens();
  majStatut();
  lignes = [nouvelleLigne()];
  dessinerLignes();
  dessinerRembs();
  if (comptes.length > 0) $('montant').focus();
}