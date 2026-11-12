import * as db from '../db.js';
import { message, euros, lireMontant, normaliser } from '../outils.js';

const TYPE_EXTERNE = 'Externe';
const MODE_SAISIE = 'formulaire';

// Rubriques proposées par défaut (chemin N1 › N2). Adapte les noms s'ils diffèrent des tiens :
// si un chemin n'est pas trouvé, la liste reste sur « Choisir… ».
const TYPES_VIREMENT = [
  { valeur: 'mensuelle', libelle: 'Contribution mensuelle', titre: 'Contribution mensuelle',
    payeur: ['Compte Commun', 'Contribution mensuelle'],
    receveur: ['Contribution Compte Commun', 'Contribution mensuelle'] },
  { valeur: 'exceptionnelle', libelle: 'Contribution exceptionnelle', titre: 'Contribution exceptionnelle',
    payeur: ['Compte Commun', 'Contribution exceptionnelle'],
    receveur: ['Contribution Compte Commun', 'Contribution exceptionnelle'] },
  { valeur: 'autre', libelle: 'Virement', titre: 'Autre virement', payeur: null, receveur: null },
];

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ
const moisFr = iso => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function option(valeur, texte) {
  const o = document.createElement('option');
  o.value = valeur;
  o.textContent = texte;
  return o;
}

// Rubriques feuilles actives (utilisables) + recherche par chemin
function chargerFeuilles() {
  const toutes = db.lire('SELECT id, nom, parent_id, actif FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, { ...r, enfants: [] }]));
  for (const r of parId.values()) if (r.actif) parId.get(r.parent_id)?.enfants.push(r);
  const chemin = id => {
    const noms = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) noms.unshift(r.nom);
    return noms.join(' › ');
  };
  const feuilles = [...parId.values()]
    .filter(r => r.actif && r.enfants.length === 0)
    .map(r => ({ id: r.id, chemin: chemin(r.id) }))
    .sort((a, b) => a.chemin.localeCompare(b.chemin, 'fr', { sensitivity: 'base' }));
  const trouver = noms => {
    const cible = noms.map(normaliser).join(' › ');
    return feuilles.find(f => normaliser(f.chemin) === cible)?.id ?? null;
  };
  return { feuilles, trouver };
}

// Dessine le formulaire dans « conteneur » ; « sauvegarder(texte) » enregistre le fichier et redessine l'écran
export function afficherFormTransfert(conteneur, sauvegarder) {
  const { feuilles, trouver } = chargerFeuilles();
  const comptes = db.lire(
    'SELECT id, nom, type FROM comptes WHERE actif = 1 ORDER BY type = ?, ordre_affichage, nom', [TYPE_EXTERNE]);
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const nom = id => compteParId.get(id)?.nom ?? '?';
  const estExterne = id => compteParId.get(id)?.type === TYPE_EXTERNE;
  const libelleCompte = c => (c.type === TYPE_EXTERNE ? `${c.nom} (externe)` : c.nom);

  conteneur.innerHTML = `
    <p class="discret aide">
      Contribution au Compte Commun, virement ponctuel… Le virement reste prévu jusqu'à son règlement
      dans « Remboursements entre comptes ». Côté compte externe, aucune rubrique n'est nécessaire.
    </p>
    <form data-ref="t-form" novalidate>
      <label>Type <select data-ref="t-type"></select></label>
      <label>Qui paie <select data-ref="t-deb"></select></label>
      <label>Qui reçoit <select data-ref="t-cred"></select></label>
      <label>Montant (€) <input data-ref="t-montant" type="text" inputmode="decimal" placeholder="800,00"></label>
      <label>Premier mois <input data-ref="t-mois" type="month"></label>
      <label>Nombre de mois <input data-ref="t-nb" type="number" min="1" max="24" value="1"></label>
      <label>Rubrique côté payeur <select data-ref="t-rub-deb"></select></label>
      <label>Rubrique côté receveur <select data-ref="t-rub-cred"></select></label>
      <label>Détail <input data-ref="t-detail" type="text" maxlength="200"></label>
      <div class="boutons-form"><button type="submit">Enregistrer le virement</button></div>
    </form>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  $('t-type').append(...TYPES_VIREMENT.map(t => option(t.valeur, t.titre)));
  for (const ref of ['t-deb', 't-cred']) {
    $(ref).append(option('', '— Choisir —'), ...comptes.map(c => option(String(c.id), libelleCompte(c))));
  }
  for (const ref of ['t-rub-deb', 't-rub-cred']) {
    $(ref).append(option('', 'Choisir…'), ...feuilles.map(f => option(String(f.id), f.chemin)));
  }
  $('t-mois').value = aujourdhui().slice(0, 7);

  // Rubriques pré-remplies selon le type ; grisées côté compte externe
  function majRubriques(appliquerType) {
    const t = TYPES_VIREMENT.find(x => x.valeur === $('t-type').value);
    const cotes = [['t-deb', 't-rub-deb', 'payeur'], ['t-cred', 't-rub-cred', 'receveur']];
    for (const [refCompte, refRub, cote] of cotes) {
      const externe = estExterne(Number($(refCompte).value));
      $(refRub).disabled = externe;
      if (externe) $(refRub).value = '';
      else if ((appliquerType || !$(refRub).value) && t.cote !== undefined) $(refRub).value = '';
      if (!externe && (appliquerType || !$(refRub).value) && t[cote]) {
        $(refRub).value = String(trouver(t[cote]) ?? '');
      } else if (!externe && appliquerType && !t[cote]) {
        $(refRub).value = '';
      }
    }
  }
  $('t-type').addEventListener('change', () => majRubriques(true));
  $('t-deb').addEventListener('change', () => majRubriques(false));
  $('t-cred').addEventListener('change', () => majRubriques(false));

  // Une opération prévue (et sa ligne) d'un côté du virement
  function insererCote(compteId, montant, libelle, rubrique, detail, mois) {
    db.executer(
      `INSERT INTO operations (compte_id, statut, montant_total, montant_estime, date_banque, libelle_bancaire, mode_saisie)
       VALUES (?, 'prevue', ?, ?, NULL, ?, ?)`,
      [compteId, montant, montant, libelle, MODE_SAISIE]);
    const id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
    if (rubrique) {
      db.executer(
        `INSERT INTO lignes_operation (operation_id, rubrique_id, montant, libelle_detail, mois_imputation, ordre)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [id, rubrique, montant, detail, mois]);
    }
    return id;
  }

  $('t-form').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const t = TYPES_VIREMENT.find(x => x.valeur === $('t-type').value);
    const deb = Number($('t-deb').value);
    const cred = Number($('t-cred').value);
    const montant = lireMontant($('t-montant').value);
    const mois = $('t-mois').value;
    const nb = Number($('t-nb').value);
    const rubDeb = Number($('t-rub-deb').value) || null;
    const rubCred = Number($('t-rub-cred').value) || null;
    const detail = $('t-detail').value.trim() || null;

    if (!deb || !cred || deb === cred) return message('Choisis deux comptes différents.', 'erreur');
    if (!montant || montant < 0) return message('Saisis un montant positif (exemple : 800,00).', 'erreur');
    if (!/^\d{4}-\d{2}$/.test(mois)) return message('Choisis le premier mois.', 'erreur');
    if (!Number.isInteger(nb) || nb < 1 || nb > 24) return message('Indique un nombre de mois entre 1 et 24.', 'erreur');
    if (!estExterne(deb) && !rubDeb) return message('Choisis la rubrique côté payeur.', 'erreur');
    if (!estExterne(cred) && !rubCred) return message('Choisis la rubrique côté receveur.', 'erreur');
    if (nb > 1 && !confirm(`Créer ${nb} virements de ${euros(montant)}, de ${moisFr(mois)} ` +
                           `à ${moisFr(decalerMois(mois, nb - 1))} ?`)) return;

    try {
      db.executer('BEGIN');
      for (let k = 0; k < nb; k++) {
        const m = `${decalerMois(mois, k)}-01`;
        const idDeb = insererCote(deb, -montant, `${t.libelle} → ${nom(cred)}`, rubDeb, detail, m);
        const idCred = insererCote(cred, montant, `${t.libelle} ← ${nom(deb)}`, rubCred, detail, m);
        db.executer('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [idCred, idDeb]);
        db.executer('UPDATE operations SET contrepartie_id = ? WHERE id = ?', [idDeb, idCred]);
      }
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Création impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder(`${nb} virement(s) de ${euros(montant)} enregistré(s) : ${nom(deb)} → ${nom(cred)}. ` +
                      'À régler dans « Remboursements entre comptes ».');
  });

  majRubriques(true);
}