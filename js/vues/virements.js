import * as db from '../db.js';
import { message, euros, dateFr } from '../outils.js';

const TYPE_EXTERNE = 'Externe';

// Paire sélectionnée, conservée quand on quitte l'écran
const etat = { a: '', b: '', jusqua: '' };

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ
const moisFr = iso => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

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

// Chemin complet d'une rubrique (N1 › N2 › N3)
function chargerChemins() {
  const toutes = db.lire('SELECT id, nom, parent_id FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, r]));
  return id => {
    const noms = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) noms.unshift(r.nom);
    return noms.join(' › ');
  };
}

export function afficherVirements(conteneur) {
  const chemin = chargerChemins();
  const tous = db.lire('SELECT id, nom, type, actif FROM comptes ORDER BY type = ?, ordre_affichage, nom', [TYPE_EXTERNE]);
  const compteParId = new Map(tous.map(c => [c.id, c]));
  const actifs = tous.filter(c => c.actif);
  const nom = id => compteParId.get(id)?.nom ?? '?';
  const libelleCompte = c => (c.type === TYPE_EXTERNE ? `${c.nom} (externe)` : c.nom);

  // net > 0 : x doit verser net à y
  const texteSolde = (x, y, net) =>
    net === 0 ? 'Équilibre : aucun virement à faire'
    : net > 0 ? `${nom(x)} doit verser ${euros(net)} à ${nom(y)}`
    : `${nom(y)} doit verser ${euros(-net)} à ${nom(x)}`;

  let aRegler = [];
  const coches = new Set(); // id de l'opération côté payeur

  conteneur.innerHTML = `
    <p><a href="#/" class="retour">← Retour à l'accueil</a></p>
    <section>
      <h2>Montants à régler entre comptes</h2>
      <p class="message" data-ref="aucune" hidden>Rien à régler entre comptes. 🎉</p>
      <div class="defilement">
        <table>
          <thead><tr><th>Comptes</th><th>Solde</th><th class="num">Opérations</th><th class="col-actions">Actions</th></tr></thead>
          <tbody data-ref="paires"></tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 data-ref="titre-regler">Régler par un virement</h2>
      <form data-ref="form-paire" novalidate>
        <label>Compte <select data-ref="a"></select></label>
        <label>Avec <select data-ref="b"></select></label>
        <label>Imputées jusqu'au mois (inclus) <input data-ref="jusqua" type="month"></label>
      </form>
      <div data-ref="bloc-liste" hidden>
        <div class="barre-outils">
          <button type="button" class="petit secondaire" data-ref="tout">Tout cocher</button>
          <button type="button" class="petit secondaire" data-ref="rien">Tout décocher</button>
          <button type="button" class="petit secondaire" data-ref="copier">📋 Copier le récapitulatif</button>
        </div>
        <p class="message" data-ref="vide-liste" hidden>Rien à régler entre ces deux comptes.</p>
        <div class="defilement">
          <table>
            <thead><tr>
              <th class="col-actions">✓</th><th>Mois</th><th>Sens</th><th>Rubrique</th><th>Détail</th><th class="num">Montant</th>
            </tr></thead>
            <tbody data-ref="liste"></tbody>
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
      <h2>Derniers virements</h2>
      <p class="message" data-ref="aucun-virement" hidden>Aucun virement pour l'instant.</p>
      <div class="defilement">
        <table>
          <thead><tr>
            <th>Date banque</th><th>De</th><th>Vers</th><th class="num">Montant</th><th class="num">Opérations</th>
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

  // ---------- 1. Montants à régler, par paire de comptes ----------
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
      charger();
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
    $(ref).addEventListener('change', () => { etat[ref] = $(ref).value; charger(); });
  }
  $('jusqua').value = etat.jusqua;
  $('jusqua').addEventListener('change', () => { etat.jusqua = $('jusqua').value; charger(); });
  $('date').value = aujourdhui();

  const texteDetail = d => [d.detail, d.date_depense ? `payé le ${dateFr(d.date_depense)}` : null]
    .filter(Boolean).join(' · ') || d.libelle || '—';
  const selection = () => aRegler.filter(d => coches.has(d.id_deb));
  const netDe = liste => liste.reduce((s, d) => s + (d.deb === Number(etat.a) ? d.montant : -d.montant), 0);

  function charger() {
    const a = Number(etat.a);
    const b = Number(etat.b);
    coches.clear();
    if (!a || !b || a === b) {
      aRegler = [];
      $('bloc-liste').hidden = true;
      return;
    }
    const surCote = (cote, expr) =>
      `(SELECT ${expr} FROM lignes_operation WHERE operation_id = ${cote}.id ORDER BY ordre LIMIT 1)`;
    aRegler = db.lire(`
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
    aRegler.forEach(d => coches.add(d.id_deb));
    dessiner();
  }

  function dessiner() {
    $('bloc-liste').hidden = false;
    $('vide-liste').hidden = aRegler.length > 0;
    $('liste').replaceChildren(...aRegler.map(d => {
      const tr = document.createElement('tr');
      const tdCase = creer('td', 'col-actions');
      const caseACocher = document.createElement('input');
      caseACocher.type = 'checkbox';
      caseACocher.checked = coches.has(d.id_deb);
      caseACocher.setAttribute('aria-label', `Inclure ${euros(d.montant)}`);
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
      zone.textContent = 'Rien de sélectionné.';
      zone.className = 'reste';
      return;
    }
    const net = netDe(liste);
    zone.textContent = `${liste.length} opération(s) sélectionnée(s) · ${texteSolde(Number(etat.a), Number(etat.b), net)}`;
    zone.className = 'reste succes';
    $('valider').textContent = net === 0 ? 'Solder par compensation' : `Créer le virement de ${euros(Math.abs(net))}`;
  }

  $('tout').addEventListener('click', () => { aRegler.forEach(d => coches.add(d.id_deb)); dessiner(); });
  $('rien').addEventListener('click', () => { coches.clear(); dessiner(); });

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
      message("Copie impossible : le navigateur a refusé l'accès au presse-papiers.", 'erreur');
    }
  });

  $('form-virement').addEventListener('submit', async evenement => {
    evenement.preventDefault();
    const a = Number(etat.a);
    const b = Number(etat.b);
    const liste = selection();
    const date = $('date').value;
    if (liste.length === 0) return message('Coche au moins une opération.', 'erreur');
    if (!date) return message('Indique la date banque du virement.', 'erreur');

    const net = netDe(liste);
    const [deb, cred] = net >= 0 ? [a, b] : [b, a];
    if (!confirm(`${texteSolde(a, b, net)}.\n\n${liste.length} opération(s) seront marquées comme réglées au ${dateFr(date)}.`)) return;

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
      ? `${liste.length} opération(s) soldée(s) par compensation.`
      : `Virement de ${euros(Math.abs(net))} de ${nom(deb)} vers ${nom(cred)} enregistré (${liste.length} opération(s) réglée(s)).`);
  });

  // ---------- 3. Derniers virements ----------
  const virements = db.lire(`
    SELECT v.id, v.date_banque, v.montant, v.compte_debiteur_id AS deb, v.compte_crediteur_id AS cred,
           (SELECT COUNT(*) FROM operations o WHERE o.virement_id = v.id AND o.montant_total < 0) AS nb
    FROM virements v
    ORDER BY v.date_banque DESC, v.id DESC
    LIMIT 10`);
  $('aucun-virement').hidden = virements.length > 0;

  async function annulerVirement(v) {
    if (!confirm(`Annuler le virement de ${euros(v.montant)} du ${dateFr(v.date_banque)} ?\n\n` +
                 `Ses ${v.nb} opération(s) redeviendront à régler.`)) return;
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
    await sauvegarder('Virement annulé : ses opérations sont de nouveau à régler.');
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

  charger();
}