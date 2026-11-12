import * as db from '../db.js';
import { message, euros, lireMontant, dateFr, normaliser } from '../outils.js';

const TYPE_EXTERNE = 'Externe';
const MODE_SAISIE = 'formulaire';

// Rubriques proposées par défaut (chemin N1 › N2). Adapte les noms s'ils diffèrent des tiens :
// si un chemin n'est pas trouvé, la liste reste sur « Choisir… ».
const TYPES_DETTE = [
  { valeur: 'mensuelle', libelle: 'Contribution mensuelle',
    payeur: ['Compte Commun', 'Contribution mensuelle'],
    receveur: ['Contribution Compte Commun', 'Contribution mensuelle'] },
  { valeur: 'exceptionnelle', libelle: 'Contribution exceptionnelle',
    payeur: ['Compte Commun', 'Contribution exceptionnelle'],
    receveur: ['Contribution Compte Commun', 'Contribution exceptionnelle'] },
  { valeur: 'autre', libelle: 'Dette', payeur: null, receveur: null },
];

// Paire sélectionnée, conservée quand on quitte l'écran
const etat = { a: '', b: '', jusqua: '' };

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ
const moisFr = iso => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
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
function bouton(texte, classes, action) {
  const b = creer('button', classes, texte);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}

// Rubriques feuilles actives (utilisables) + recherche par chemin
function chargerRubriques() {
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
  return { chemin, feuilles, trouver };
}

export function afficherVirements(conteneur) {
  const { chemin, feuilles, trouver } = chargerRubriques();
  const tous = db.lire('SELECT id, nom, type, actif FROM comptes ORDER BY type = ?, ordre_affichage, nom', [TYPE_EXTERNE]);
  const compteParId = new Map(tous.map(c => [c.id, c]));
  const actifs = tous.filter(c => c.actif);
  const nom = id => compteParId.get(id)?.nom ?? '?';
  const estExterne = id => compteParId.get(id)?.type === TYPE_EXTERNE;
  const libelleCompte = c => (c.type === TYPE_EXTERNE ? `${c.nom} (externe)` : c.nom);

  // net > 0 : x doit verser net à y
  const texteSolde = (x, y, net) =>
    net === 0 ? 'Équilibre : aucun virement à faire'
    : net > 0 ? `${nom(x)} doit verser ${euros(net)} à ${nom(y)}`
    : `${nom(y)} doit verser ${euros(-net)} à ${nom(x)}`;

  let dettes = [];
  const coches = new Set(); // id de l'opération côté débiteur

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2>Dettes en attente</h2>
      <p class="message" data-ref="aucune" hidden>Aucune dette en attente entre comptes. 🎉</p>
      <div class="defilement">
        <table>
          <thead><tr><th>Comptes</th><th>Solde</th><th class="num">Dettes</th><th class="col-actions">Actions</th></tr></thead>
          <tbody data-ref="paires"></tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 data-ref="titre-regler">Régler par un virement</h2>
      <form data-ref="form-paire" novalidate>
        <label>Compte <select data-ref="a"></select></label>
        <label>Avec <select data-ref="b"></select></label>
        <label>Dettes imputées jusqu'au mois (inclus) <input data-ref="jusqua" type="month"></label>
      </form>
      <div data-ref="bloc-dettes" hidden>
        <div class="barre-outils">
          <button type="button" class="petit secondaire" data-ref="tout">Tout cocher</button>
          <button type="button" class="petit secondaire" data-ref="rien">Tout décocher</button>
          <button type="button" class="petit secondaire" data-ref="copier">📋 Copier le récapitulatif</button>
        </div>
        <p class="message" data-ref="vide-dettes" hidden>Aucune dette en attente entre ces deux comptes.</p>
        <div class="defilement">
          <table>
            <thead><tr>
              <th class="col-actions">✓</th><th>Mois</th><th>Sens</th><th>Rubrique</th><th>Détail</th><th class="num">Montant</th>
            </tr></thead>
            <tbody data-ref="dettes"></tbody>
          </table>
        </div>
        <p class="reste" data-ref="net" aria-live="polite"></p>
        <form data-ref="form-virement" novalidate>
          <label>Date banque du virement <input data-ref="date" type="date"></label>
          <div class="boutons-form"><button type="submit" data-ref="valider">Créer le virement</button></div>
        </form>
      </div>
    </section>

    <section>
      <h2>Nouvelle dette</h2>
      <p class="discret aide">
        Contribution au Compte Commun, dette ponctuelle… Elle reste prévue jusqu'au virement qui la règle.
        Côté compte externe, aucune rubrique n'est nécessaire.
      </p>
      <form data-ref="form-dette" novalidate>
        <label>Type <select data-ref="d-type"></select></label>
        <label>Qui paie <select data-ref="d-deb"></select></label>
        <label>Qui reçoit <select data-ref="d-cred"></select></label>
        <label>Montant (€) <input data-ref="d-montant" type="text" inputmode="decimal" placeholder="800,00"></label>
        <label>Premier mois <input data-ref="d-mois" type="month"></label>
        <label>Nombre de mois <input data-ref="d-nb" type="number" min="1" max="24" value="1"></label>
        <label>Rubrique côté payeur <select data-ref="d-rub-deb"></select></label>
        <label>Rubrique côté receveur <select data-ref="d-rub-cred"></select></label>
        <label>Détail <input data-ref="d-detail" type="text" maxlength="200"></label>
        <div class="boutons-form"><button type="submit">Créer la dette</button></div>
      </form>
    </section>

    <section>
      <h2>Derniers virements</h2>
      <p class="message" data-ref="aucun-virement" hidden>Aucun virement pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Date banque</th><th>De</th><th>Vers</th><th class="num">Montant</th><th class="num">Dettes</th>
            <th class="col-actions">Actions</th>
          </tr></thead>
          <tbody data-ref="virements"></tbody>
        </table>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  async function sauvegarder(texte) {
    try {
      await db.enregistrer();
      message(texte, 'succes');
    } catch (e) {
      message(`Modification faite, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
    afficherVirements(conteneur);
  }

  // ---------- 1. Dettes en attente, par paire de comptes ----------
  const brut = db.lire(`
    SELECT a.compte_id AS deb, b.compte_id AS cred, SUM(b.montant_total) AS montant, COUNT(*) AS nb
    FROM operations a
    JOIN operations b ON b.id = a.contrepartie_id
    WHERE a.montant_total < 0 AND a.statut = 'prevue' AND b.statut = 'prevue'
    GROUP BY a.compte_id, b.compte_id`);
  const paires = new Map();
  for (const r of brut) {
    const [x, y] = r.deb < r.cred ? [r.deb, r.cred] : [r.cred, r.deb];
    const p = paires.get(`${x}-${y}`) ?? { x, y, net: 0, nb: 0 };
    p.net += r.deb === x ? r.montant : -r.montant;
    p.nb += r.nb;
    paires.set(`${x}-${y}`, p);
  }
  $('aucune').hidden = paires.size > 0;
  $('paires').replaceChildren(...[...paires.values()].map(p => {
    const tr = document.createElement('tr');
    const tdActions = creer('td', 'col-actions');
    tdActions.append(bouton('Voir le détail', 'petit secondaire', () => {
      Object.assign(etat, { a: String(p.x), b: String(p.y), jusqua: '' });
      $('a').value = etat.a;
      $('b').value = etat.b;
      $('jusqua').value = '';
      chargerDettes();
      $('titre-regler').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    tr.append(
      creer('td', null, `${nom(p.x)} ↔ ${nom(p.y)}`),
      creer('td', null, texteSolde(p.x, p.y, p.net)),
      creer('td', 'num', String(p.nb)),
      tdActions);
    return tr;
  }));

  // ---------- 2. Régler une paire ----------
  for (const ref of ['a', 'b']) {
    $(ref).append(option('', '— Choisir —'), ...actifs.map(c => option(String(c.id), libelleCompte(c))));
    $(ref).value = etat[ref];
    etat[ref] = $(ref).value;
    $(ref).addEventListener('change', () => { etat[ref] = $(ref).value; chargerDettes(); });
  }
  $('jusqua').value = etat.jusqua;
  $('jusqua').addEventListener('change', () => { etat.jusqua = $('jusqua').value; chargerDettes(); });
  $('date').value = aujourdhui();

  const texteDetail = d => [d.detail, d.date_depense ? `payé le ${dateFr(d.date_depense)}` : null]
    .filter(Boolean).join(' · ') || d.libelle || '—';
  const selection = () => dettes.filter(d => coches.has(d.id_deb));
  const netDe = liste => liste.reduce((s, d) => s + (d.deb === Number(etat.a) ? d.montant : -d.montant), 0);

  function chargerDettes() {
    const a = Number(etat.a);
    const b = Number(etat.b);
    coches.clear();
    if (!a || !b || a === b) {
      dettes = [];
      $('bloc-dettes').hidden = true;
      return;
    }
    const surCote = (cote, expr) =>
      `(SELECT ${expr} FROM lignes_operation WHERE operation_id = ${cote}.id ORDER BY ordre LIMIT 1)`;
    dettes = db.lire(`
      SELECT a.id AS id_deb, b.id AS id_cred, a.compte_id AS deb, b.compte_id AS cred,
             b.montant_total AS montant, a.libelle_bancaire AS libelle, p.date_banque AS date_depense,
             COALESCE(${surCote('a', 'mois_imputation')}, ${surCote('b', 'mois_imputation')}) AS mois,
             COALESCE(${surCote('a', 'rubrique_id')}, ${surCote('b', 'rubrique_id')}) AS rubrique_id,
             COALESCE(${surCote('a', 'libelle_detail')}, ${surCote('b', 'libelle_detail')}) AS detail
      FROM operations a
      JOIN operations b ON b.id = a.contrepartie_id
      LEFT JOIN operations p ON p.id = a.operation_liee_id
      WHERE a.montant_total < 0 AND a.statut = 'prevue' AND b.statut = 'prevue'
        AND ((a.compte_id = ? AND b.compte_id = ?) OR (a.compte_id = ? AND b.compte_id = ?))
      ORDER BY mois, a.id`, [a, b, b, a])
      .filter(d => !etat.jusqua || !d.mois || d.mois <= `${etat.jusqua}-01`);
    dettes.forEach(d => coches.add(d.id_deb));
    dessinerDettes();
  }

  function dessinerDettes() {
    $('bloc-dettes').hidden = false;
    $('vide-dettes').hidden = dettes.length > 0;
    $('dettes').replaceChildren(...dettes.map(d => {
      const tr = document.createElement('tr');
      const tdCase = creer('td', 'col-actions');
      const caseACocher = document.createElement('input');
      caseACocher.type = 'checkbox';
      caseACocher.checked = coches.has(d.id_deb);
      caseACocher.setAttribute('aria-label', `Inclure la dette de ${euros(d.montant)}`);
      caseACocher.addEventListener('change', () => {
        if (caseACocher.checked) coches.add(d.id_deb); else coches.delete(d.id_deb);
        majNet();
      });
      tdCase.append(caseACocher);
      tr.append(
        tdCase,
        creer('td', null, moisFr(d.mois)),
        creer('td', null, `${nom(d.deb)} → ${nom(d.cred)}`),
        creer('td', null, d.rubrique_id ? chemin(d.rubrique_id) : '—'),
        creer('td', null, texteDetail(d)),
        creer('td', 'num', euros(d.montant)));
      return tr;
    }));
    majNet();
  }

  function majNet() {
    const liste = selection();
    const zone = $('net');
    $('valider').disabled = liste.length === 0;
    $('copier').disabled = liste.length === 0;
    if (liste.length === 0) {
      zone.textContent = 'Aucune dette sélectionnée.';
      zone.className = 'reste';
      return;
    }
    const net = netDe(liste);
    zone.textContent = `${liste.length} dette(s) sélectionnée(s) · ${texteSolde(Number(etat.a), Number(etat.b), net)}`;
    zone.className = 'reste succes';
    $('valider').textContent = net === 0 ? 'Solder par compensation' : `Créer le virement de ${euros(Math.abs(net))}`;
  }

  $('tout').addEventListener('click', () => { dettes.forEach(d => coches.add(d.id_deb)); dessinerDettes(); });
  $('rien').addEventListener('click', () => { coches.clear(); dessinerDettes(); });

  $('copier').addEventListener('click', async () => {
    const a = Number(etat.a);
    const b = Number(etat.b);
    const liste = selection();
    const texte = [
      `Récapitulatif ${nom(a)} ↔ ${nom(b)} au ${dateFr(aujourdhui())}`,
      '',
      ...liste.map(d => {
        const detail = texteDetail(d);
        return `• ${moisFr(d.mois)} · ${d.rubrique_id ? chemin(d.rubrique_id) : '—'}` +
               `${detail !== '—' ? ` · ${detail}` : ''} : ${euros(d.montant)} (${nom(d.deb)} → ${nom(d.cred)})`;
      }),
      '',
      `Solde : ${texteSolde(a, b, netDe(liste))}.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(texte);
      message('Récapitulatif copié : tu peux le coller dans un message.', 'succes');
    } catch {
      message('Copie impossible : le navigateur a refusé l\'accès au presse-papiers.', 'erreur');
    }
  });

  $('form-virement').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const a = Number(etat.a);
    const b = Number(etat.b);
    const liste = selection();
    const date = $('date').value;
    if (liste.length === 0) return message('Coche au moins une dette.', 'erreur');
    if (!date) return message('Indique la date banque du virement.', 'erreur');

    const net = netDe(liste);
    const [deb, cred] = net >= 0 ? [a, b] : [b, a];
    if (!confirm(`${texteSolde(a, b, net)}.\n\n${liste.length} dette(s) seront marquées comme réglées au ${dateFr(date)}.`)) return;

    const ids = liste.flatMap(d => [d.id_deb, d.id_cred]);
    try {
      db.executer('BEGIN');
      db.executer(
        'INSERT INTO virements (compte_debiteur_id, compte_crediteur_id, montant, date_banque) VALUES (?, ?, ?, ?)',
        [deb, cred, Math.abs(net), date]);
      const id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
      db.executer(
        `UPDATE operations SET statut = 'realisee', date_banque = ?, virement_id = ?
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        [date, id, ...ids]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Virement impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder(net === 0
      ? `${liste.length} dette(s) soldée(s) par compensation.`
      : `Virement de ${euros(Math.abs(net))} de ${nom(deb)} vers ${nom(cred)} enregistré (${liste.length} dette(s) réglée(s)).`);
  });

  // ---------- 3. Nouvelle dette ----------
  $('d-type').append(...TYPES_DETTE.map(t => option(t.valeur, t.valeur === 'autre' ? 'Autre dette' : t.libelle)));
  for (const ref of ['d-deb', 'd-cred']) {
    $(ref).append(option('', '— Choisir —'), ...actifs.map(c => option(String(c.id), libelleCompte(c))));
  }
  for (const ref of ['d-rub-deb', 'd-rub-cred']) {
    $(ref).append(option('', 'Choisir…'), ...feuilles.map(f => option(String(f.id), f.chemin)));
  }
  $('d-mois').value = aujourdhui().slice(0, 7);

  function majRubriquesDette(appliquerType) {
    const t = TYPES_DETTE.find(x => x.valeur === $('d-type').value);
    for (const [refCompte, refRub, cote] of [['d-deb', 'd-rub-deb', 'payeur'], ['d-cred', 'd-rub-cred', 'receveur']]) {
      const externe = estExterne(Number($(refCompte).value));
      $(refRub).disabled = externe;
      if (externe) $(refRub).value = '';
      else if ((appliquerType || !$(refRub).value) && t[cote]) $(refRub).value = String(trouver(t[cote]) ?? '');
      else if (appliquerType) $(refRub).value = '';
    }
  }
  $('d-type').addEventListener('change', () => majRubriquesDette(true));
  $('d-deb').addEventListener('change', () => majRubriquesDette(false));
  $('d-cred').addEventListener('change', () => majRubriquesDette(false));

  // Une opération prévue (et sa ligne) d'un côté de la dette
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

  $('form-dette').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const t = TYPES_DETTE.find(x => x.valeur === $('d-type').value);
    const deb = Number($('d-deb').value);
    const cred = Number($('d-cred').value);
    const montant = lireMontant($('d-montant').value);
    const mois = $('d-mois').value;
    const nb = Number($('d-nb').value);
    const rubDeb = Number($('d-rub-deb').value) || null;
    const rubCred = Number($('d-rub-cred').value) || null;
    const detail = $('d-detail').value.trim() || null;

    if (!deb || !cred || deb === cred) return message('Choisis deux comptes différents.', 'erreur');
    if (!montant || montant < 0) return message('Saisis un montant positif (exemple : 800,00).', 'erreur');
    if (!/^\d{4}-\d{2}$/.test(mois)) return message('Choisis le premier mois.', 'erreur');
    if (!Number.isInteger(nb) || nb < 1 || nb > 24) return message('Indique un nombre de mois entre 1 et 24.', 'erreur');
    if (!estExterne(deb) && !rubDeb) return message('Choisis la rubrique côté payeur.', 'erreur');
    if (!estExterne(cred) && !rubCred) return message('Choisis la rubrique côté receveur.', 'erreur');
    if (nb > 1 && !confirm(`Créer ${nb} dettes de ${euros(montant)}, de ${moisFr(`${mois}-01`)} ` +
                           `à ${moisFr(`${decalerMois(mois, nb - 1)}-01`)} ?`)) return;

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
    await sauvegarder(`${nb} dette(s) de ${euros(montant)} créée(s) : ${nom(deb)} → ${nom(cred)}.`);
  });

  // ---------- 4. Derniers virements ----------
  const virements = db.lire(`
    SELECT v.id, v.date_banque, v.montant, v.compte_debiteur_id AS deb, v.compte_crediteur_id AS cred,
           (SELECT COUNT(*) FROM operations o WHERE o.virement_id = v.id AND o.montant_total < 0) AS nb
    FROM virements v
    ORDER BY v.date_banque DESC, v.id DESC
    LIMIT 10`);
  $('aucun-virement').hidden = virements.length > 0;

  async function annulerVirement(v) {
    if (!confirm(`Annuler le virement de ${euros(v.montant)} du ${dateFr(v.date_banque)} ?\n\n` +
                 `Ses ${v.nb} dette(s) redeviendront prévues.`)) return;
    try {
      db.executer('BEGIN');
      db.executer(
        "UPDATE operations SET statut = 'prevue', date_banque = NULL, virement_id = NULL WHERE virement_id = ?", [v.id]);
      db.executer('DELETE FROM virements WHERE id = ?', [v.id]);
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Annulation impossible : ${e.message}`, 'erreur');
    }
    await sauvegarder('Virement annulé : ses dettes sont de nouveau en attente.');
  }

  $('virements').replaceChildren(...virements.map(v => {
    const tr = document.createElement('tr');
    const tdActions = creer('td', 'col-actions');
    tdActions.append(bouton('Annuler', 'petit danger', () => annulerVirement(v)));
    tr.append(
      creer('td', null, dateFr(v.date_banque)),
      creer('td', null, nom(v.deb)),
      creer('td', null, nom(v.cred)),
      creer('td', 'num', euros(v.montant)),
      creer('td', 'num', String(v.nb)),
      tdActions);
    return tr;
  }));

  // ---------- Démarrage ----------
  majRubriquesDette(true);
  chargerDettes();
}