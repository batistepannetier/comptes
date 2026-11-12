import * as db from '../db.js';
import { message, euros, lireMontant, montantPourSaisie, dateFr } from '../outils.js';

const STATUTS = { realisee: 'Réalisée', prevue: 'Prévue' };
const TYPES = [
  { valeur: 'hors-comptes', libelle: 'Tout sauf mouvements entre comptes' },
  { valeur: 'tout',         libelle: 'Tout' },
  { valeur: 'principale',   libelle: 'Dépenses et revenus' },
  { valeur: 'organisme',    libelle: 'Remboursements par un organisme' },
  { valeur: 'compte',       libelle: 'Mouvements entre comptes' },
];
const CONDITIONS_TYPE = {
  'tout': null,
  'hors-comptes': 'o.contrepartie_id IS NULL',
  'principale': 'o.operation_liee_id IS NULL AND o.contrepartie_id IS NULL',
  'organisme': 'o.operation_liee_id IS NOT NULL AND o.contrepartie_id IS NULL',
  'compte': 'o.contrepartie_id IS NOT NULL',
};
const LIMITE = 300;
const DEFAUT = { compte: '', mois: '', statut: 'prevue', type: 'hors-comptes', rubrique: '', texte: '' };

// Filtres conservés quand on quitte l'écran
const filtres = { ...DEFAUT };

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ
const moisFr = iso => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

// Répartit un montant (centimes, éventuellement négatif) au prorata ; le reste va sur le dernier
function repartir(montant, poids) {
  if (poids.every(p => p === 0)) poids = poids.map(() => 1);
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
function bouton(texte, classes, action) {
  const b = creer('button', classes, texte);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}

function chargerRubriques() {
  const toutes = db.lire('SELECT id, nom, parent_id FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, { ...r, enfants: [] }]));
  for (const r of parId.values()) parId.get(r.parent_id)?.enfants.push(r);
  const tri = (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
  const racines = [...parId.values()].filter(r => r.parent_id === null).sort(tri);
  racines.forEach(r => r.enfants.sort(tri));
  const chemin = id => {
    const noms = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) noms.unshift(r.nom);
    return noms.join(' › ');
  };
  const descendants = id => {
    const r = parId.get(id);
    return r ? [r.id, ...r.enfants.flatMap(e => descendants(e.id))] : [];
  };
  return { racines, chemin, descendants };
}

export function afficherSuivi(conteneur) {
  const { racines, chemin, descendants } = chargerRubriques();
  const comptes = db.lire('SELECT id, nom FROM comptes ORDER BY actif DESC, ordre_affichage, nom');
  let enEdition = null;

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section data-ref="bloc-edition" hidden>
      <h2 data-ref="titre-edition"></h2>
      <p class="discret aide" data-ref="infos-edition"></p>
      <form data-ref="form" novalidate>
        <label>Montant (€) <input data-ref="montant" type="text" inputmode="decimal"></label>
        <label>Date banque (vide = prévue) <input data-ref="date" type="date"></label>
        <div class="boutons-form">
          <button type="submit">Enregistrer</button>
          <button type="button" class="secondaire" data-ref="aujourdhui">Passée aujourd'hui</button>
          <button type="button" class="secondaire" data-ref="annuler">Annuler</button>
        </div>
      </form>
    </section>
    <section>
      <h2>Suivi des opérations</h2>
      <form data-ref="filtres" novalidate>
        <label>Compte <select data-ref="f-compte"></select></label>
        <label>Mois d'imputation <input data-ref="f-mois" type="month"></label>
        <label>Statut
          <select data-ref="f-statut">
            <option value="prevue">Prévues (pas encore passées)</option>
            <option value="realisee">Réalisées</option>
            <option value="">Toutes</option>
          </select>
        </label>
        <label>Type <select data-ref="f-type"></select></label>
        <label>Rubrique <select data-ref="f-rubrique"></select></label>
        <label>Recherche <input data-ref="f-texte" type="search" placeholder="Détail, libellé…"></label>
        <div class="boutons-form">
          <button type="button" class="petit secondaire" data-ref="reinit">Réinitialiser les filtres</button>
        </div>
      </form>
      <p data-ref="resume" class="discret" aria-live="polite"></p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Date banque</th><th>Compte</th><th>Rubrique</th><th>Détail</th><th>Imputation</th>
            <th class="num">Montant</th><th class="num">Estimé</th><th>Statut</th><th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // ---------- Filtres ----------
  $('f-compte').append(option('', 'Tous les comptes'), ...comptes.map(c => option(String(c.id), c.nom)));
  $('f-type').append(...TYPES.map(t => option(t.valeur, t.libelle)));
  $('f-rubrique').append(option('', 'Toutes les rubriques'));
  for (const r of racines) {
    $('f-rubrique').append(option(String(r.id), r.nom));
    for (const e of r.enfants) $('f-rubrique').append(option(String(e.id), `${r.nom} › ${e.nom}`));
  }

  const CHAMPS = { compte: 'f-compte', mois: 'f-mois', statut: 'f-statut', type: 'f-type', rubrique: 'f-rubrique', texte: 'f-texte' };
  function appliquerFiltresAuxChamps() {
    for (const [cle, ref] of Object.entries(CHAMPS)) {
      $(ref).value = filtres[cle];
      filtres[cle] = $(ref).value; // si la valeur n'existe plus (compte supprimé…)
    }
  }
  for (const [cle, ref] of Object.entries(CHAMPS)) {
    $(ref).addEventListener('input', () => { filtres[cle] = $(ref).value; dessiner(); });
  }
  $('reinit').addEventListener('click', () => {
    Object.assign(filtres, DEFAUT);
    appliquerFiltresAuxChamps();
    dessiner();
  });

  // ---------- Liste ----------
  function imputation(o) {
    if (!o.mois_debut) return '—';
    return o.nb_mois > 1
      ? `${moisFr(o.mois_debut)} → ${moisFr(o.mois_fin)} (${o.nb_mois} mois)`
      : moisFr(o.mois_debut);
  }
  const texteDetail = o => [o.libelle_bancaire, o.detail].filter(Boolean).join(' — ') || '—';

  function dessiner() {
    const where = [];
    const params = [];
    const surLignes = condition => `EXISTS (SELECT 1 FROM lignes_operation x WHERE x.operation_id = o.id AND ${condition})`;

    if (filtres.compte) { where.push('o.compte_id = ?'); params.push(Number(filtres.compte)); }
    if (filtres.statut) { where.push('o.statut = ?'); params.push(filtres.statut); }
    if (CONDITIONS_TYPE[filtres.type]) where.push(CONDITIONS_TYPE[filtres.type]);
    if (filtres.mois) { where.push(surLignes('x.mois_imputation = ?')); params.push(`${filtres.mois}-01`); }
    if (filtres.rubrique) {
      const ids = descendants(Number(filtres.rubrique));
      where.push(surLignes(`x.rubrique_id IN (${ids.map(() => '?').join(',')})`));
      params.push(...ids);
    }
    const texte = filtres.texte.trim();
    if (texte) {
      where.push(`(o.libelle_bancaire LIKE ? OR ${surLignes('x.libelle_detail LIKE ?')})`);
      params.push(`%${texte}%`, `%${texte}%`);
    }

    const ops = db.lire(`
      SELECT o.id, o.compte_id, c.nom AS compte, o.statut, o.montant_total, o.montant_estime,
             o.date_banque, o.libelle_bancaire, o.operation_liee_id, o.contrepartie_id,
             MIN(l.mois_imputation) AS mois_debut, MAX(l.mois_imputation) AS mois_fin,
             COUNT(l.id) AS nb_mois, MIN(l.rubrique_id) AS rubrique_id, MAX(l.libelle_detail) AS detail
      FROM operations o
      JOIN comptes c ON c.id = o.compte_id
      LEFT JOIN lignes_operation l ON l.operation_id = o.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY o.id
      ORDER BY o.statut = 'prevue' DESC, o.date_banque DESC, MIN(l.mois_imputation) DESC, o.id DESC
      LIMIT ${LIMITE + 1}`, params);

    const tronque = ops.length > LIMITE;
    if (tronque) ops.pop();
    const total = ops.reduce((s, o) => s + o.montant_total, 0);
    $('resume').textContent = ops.length === 0
      ? 'Aucune opération ne correspond aux filtres.'
      : `${ops.length} opération(s), total ${euros(total)}` +
        (tronque ? ` (seules les ${LIMITE} premières sont affichées : affine les filtres)` : '') + '.';

    $('liste').replaceChildren(...ops.map(o => {
      const tr = document.createElement('tr');
      if (o.id === enEdition?.id) tr.className = 'selection';
      tr.append(
        creer('td', null, dateFr(o.date_banque)),
        creer('td', null, o.compte),
        creer('td', null, o.rubrique_id ? chemin(o.rubrique_id) : '—'),
        creer('td', null, texteDetail(o)),
        creer('td', null, imputation(o)),
        creer('td', o.montant_total < 0 ? 'num negatif' : 'num', euros(o.montant_total)),
        creer('td', 'num discret', o.montant_estime !== null ? euros(o.montant_estime) : ''),
        creer('td', null, STATUTS[o.statut] ?? o.statut));

      const tdActions = creer('td', 'col-actions');
      if (o.contrepartie_id !== null) {
        tdActions.append(creer('span', 'discret', 'Via les virements'));
      } else {
        tdActions.append(bouton(o.statut === 'prevue' ? 'Pointer' : 'Modifier', 'petit secondaire', () => ouvrirEdition(o)));
      }
      tr.append(tdActions);
      return tr;
    }));
  }

  // ---------- Pointage / modification ----------
  function ouvrirEdition(o) {
    enEdition = o;
    $('bloc-edition').hidden = false;
    $('titre-edition').textContent = o.statut === 'prevue' ? 'Pointer une opération prévue' : 'Modifier une opération';
    $('infos-edition').textContent = [
      o.compte,
      o.rubrique_id ? chemin(o.rubrique_id) : null,
      texteDetail(o) !== '—' ? texteDetail(o) : null,
      `imputation ${imputation(o)}`,
      o.montant_estime !== null ? `estimation initiale ${euros(Math.abs(o.montant_estime))}` : null,
      o.montant_total < 0 ? 'dépense' : 'revenu',
    ].filter(Boolean).join(' · ');
    $('montant').value = montantPourSaisie(Math.abs(o.montant_total));
    $('date').value = o.date_banque ?? '';
    dessiner(); // surligne la ligne en cours
    $('titre-edition').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('montant').focus({ preventScroll: true });
  }

  function fermerEdition() {
    enEdition = null;
    $('bloc-edition').hidden = true;
    dessiner();
  }

  $('annuler').addEventListener('click', fermerEdition);
  $('aujourdhui').addEventListener('click', () => { $('date').value = aujourdhui(); });

  $('form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    if (!enEdition) return;
    const o = enEdition;
    const valeur = lireMontant($('montant').value);
    if (!valeur || valeur < 0) {
      return message('Saisis un montant positif : le sens (dépense ou revenu) est conservé.', 'erreur');
    }
    const date = $('date').value || null;
    const signe = o.montant_total < 0 ? -1 : 1;
    const nouveau = signe * valeur;
    const ecart = nouveau - o.montant_total;

    // Règle : les mois passés ne bougent pas, l'écart va sur le mois en cours et les mois à venir
    let maj = [];
    let avertissement = '';
    if (ecart !== 0) {
      const lignes = db.lire(
        'SELECT id, montant, mois_imputation FROM lignes_operation WHERE operation_id = ? ORDER BY mois_imputation, ordre',
        [o.id]);
      let cibles = lignes;
      if (lignes.length > 1) {
        const debutMoisCourant = `${aujourdhui().slice(0, 7)}-01`;
        cibles = lignes.filter(l => l.mois_imputation >= debutMoisCourant);
        if (cibles.length === 0) {
          cibles = [lignes[lignes.length - 1]];
          avertissement = " Tous les mois étaient passés : l'écart a été imputé sur le dernier mois.";
        }
      }
      if (cibles.length > 0) {
        const parts = repartir(ecart, cibles.map(l => Math.abs(l.montant)));
        maj = cibles.map((l, k) => ({ id: l.id, montant: l.montant + parts[k] }));
        if (maj.some(l => l.montant * signe < 0)) {
          return message('La baisse dépasse le montant des mois à venir (les mois passés ne sont jamais modifiés).', 'erreur');
        }
      }
    }

    try {
      db.executer('BEGIN');
      db.executer('UPDATE operations SET montant_total = ?, date_banque = ?, statut = ? WHERE id = ?',
                  [nouveau, date, date ? 'realisee' : 'prevue', o.id]);
      for (const l of maj) db.executer('UPDATE lignes_operation SET montant = ? WHERE id = ?', [l.montant, l.id]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Modification impossible : ${e.message}`, 'erreur');
    }

    const texte = date
      ? `Opération de ${euros(nouveau)} pointée au ${dateFr(date)}.${avertissement}`
      : `Opération mise à jour (${euros(nouveau)}, toujours prévue).${avertissement}`;
    try {
      await db.enregistrer();
      message(texte, 'succes');
    } catch (e) {
      message(`Modification faite, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
    afficherSuivi(conteneur);
  });

  appliquerFiltresAuxChamps();
  dessiner();
}