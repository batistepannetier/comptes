import * as db from '../db.js';
import { message, euros, lireMontant, normaliser } from '../outils.js';

const TYPE_EXTERNE = 'Externe';
const NB_REMB = 3;
const LONGUEUR_DETAIL = 200;
const LONGUEUR_ORGANISME = 60;
const COLONNES = ['Compte', 'Niveau 1', 'Niveau 2', 'Niveau 3', 'Détail', 'Montant',
  ...Array.from({ length: NB_REMB }, (_, k) => [`Remboursé par ${k + 1}`, `Montant ${k + 1}`]).flat()];

const SEP = '\u0001';

// Index des rubriques par chemin normalisé (« courses␁alimentation␁biocoop »)
function chargerRubriques() {
  const toutes = db.lire('SELECT id, nom, parent_id, actif FROM rubriques');
  const parId = new Map(toutes.map(r => [r.id, { ...r, enfants: [] }]));
  for (const r of parId.values()) parId.get(r.parent_id)?.enfants.push(r);
  const noms = id => {
    const n = [];
    for (let r = parId.get(id); r; r = parId.get(r.parent_id)) n.unshift(r.nom);
    return n;
  };
  const parChemin = new Map();
  for (const r of parId.values()) parChemin.set(noms(r.id).map(normaliser).join(SEP), r);
  const chemin = id => noms(id).join(' › ');
  return { parChemin, chemin };
}

// "" → vide ; "45,90 €" → 4590 ; invalide → null
function lireCelluleMontant(texte) {
  const t = texte.replace(/€/g, '').trim();
  if (t === '') return { vide: true };
  const m = lireMontant(t);
  return m && m > 0 ? { valeur: m } : null;
}

export function afficherImportRapides(conteneur) {
  const { parChemin, chemin } = chargerRubriques();
  const comptes = db.lire('SELECT id, nom, type, actif FROM comptes');
  const compteParNom = new Map(comptes.map(c => [normaliser(c.nom), c]));
  const compteParId = new Map(comptes.map(c => [c.id, c]));
  const nomCompte = id => compteParId.get(id)?.nom ?? '?';

  // Clés des dépenses rapides existantes : compte|rubrique|détail
  const cle = (compte, rubrique, detail) => `${compte}|${rubrique}|${normaliser(detail ?? '')}`;
  const existantes = new Set(
    db.lire('SELECT compte_id, rubrique_id, detail FROM depenses_rapides')
      .map(r => cle(r.compte_id, r.rubrique_id, r.detail)));

  let analyse = null;
  let entetesModifie = false;

  conteneur.innerHTML = `
    <p><a href="#/rapides" class="retour">← Retour aux dépenses rapides</a></p>
    <section>
      <h2>Importer des dépenses rapides depuis Excel</h2>
      <p class="discret">
        Colonnes attendues, dans cet ordre : ${COLONNES.join(' · ')}.
        Les comptes et les rubriques doivent déjà exister. Un montant de remboursement vide vaut « le reste ».
      </p>
      <div class="barre-outils">
        <button type="button" class="petit secondaire" data-ref="copier-entetes">📋 Copier les en-têtes</button>
      </div>
      <label>Données copiées depuis Excel
        <textarea data-ref="collage" rows="10" spellcheck="false"
                  placeholder="Compte → Niveau 1 → Niveau 2 → Niveau 3 → Détail → Montant → Remboursé par 1 → Montant 1…"></textarea>
      </label>
      <div class="options">
        <label class="case"><input type="checkbox" data-ref="entetes"> La première ligne contient les en-têtes</label>
      </div>
    </section>
    <section data-ref="apercu" hidden>
      <h2>Aperçu</h2>
      <p data-ref="resume" aria-live="polite"></p>
      <div data-ref="bloc-erreurs" hidden>
        <h3>Lignes ignorées</h3>
        <ul class="erreurs" data-ref="erreurs"></ul>
      </div>
      <div class="defilement apercu-liste">
        <table>
          <thead><tr>
            <th>Ligne</th><th>Dépense</th><th>Compte</th><th>Rubrique</th>
            <th class="num">Montant</th><th>Remboursements</th><th>Statut</th>
          </tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
      <div class="boutons-form">
        <button type="button" data-ref="importer">Importer</button>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // ---------- Analyse d'une ligne ----------
  function analyserLigne(cellules) {
    const [compteTxt = '', n1 = '', n2 = '', n3 = '', detailTxt = '', montantTxt = '', ...restes] = cellules;
    const erreur = raison => ({ erreur: raison });

    // Compte payeur
    if (!compteTxt) return erreur('compte manquant');
    const compte = compteParNom.get(normaliser(compteTxt));
    if (!compte) return erreur(`compte « ${compteTxt} » inconnu`);
    if (!compte.actif) return erreur(`compte « ${compte.nom} » inactif`);

    // Rubrique (niveaux vides autorisés seulement à la fin)
    const noms = [n1, n2, n3];
    while (noms.length > 0 && !noms[noms.length - 1]) noms.pop();
    if (noms.length === 0) return erreur('rubrique manquante');
    if (noms.some(n => !n)) return erreur('case vide au milieu de la rubrique');
    const rub = parChemin.get(noms.map(normaliser).join(SEP));
    if (!rub) return erreur(`rubrique « ${noms.join(' › ')} » introuvable`);
    if (!rub.actif) return erreur(`rubrique « ${chemin(rub.id)} » inactive`);
    if (rub.enfants.some(e => e.actif)) {
      return erreur(`« ${chemin(rub.id)} » a des sous-rubriques : précise le niveau suivant`);
    }

    // Détail et montant
    const detail = detailTxt || null;
    if (detail && detail.length > LONGUEUR_DETAIL) return erreur(`détail de plus de ${LONGUEUR_DETAIL} caractères`);
    const m = lireCelluleMontant(montantTxt);
    if (!m) return erreur(`montant « ${montantTxt} » invalide`);
    const montant = m.vide ? null : m.valeur;

    // Remboursements
    const rembs = [];
    for (let k = 0; k < NB_REMB; k++) {
      const source = restes[2 * k] ?? '';
      const montantRemb = restes[2 * k + 1] ?? '';
      if (!source && !montantRemb) continue;
      if (!source) return erreur(`remboursement ${k + 1} : montant sans compte ni organisme`);
      const mr = lireCelluleMontant(montantRemb);
      if (!mr) return erreur(`remboursement ${k + 1} : montant « ${montantRemb} » invalide`);

      const c = compteParNom.get(normaliser(source));
      if (c) {
        if (!c.actif) return erreur(`remboursement ${k + 1} : compte « ${c.nom} » inactif`);
        if (c.id === compte.id) return erreur(`remboursement ${k + 1} : même compte que le payeur`);
        rembs.push({ type: 'compte', organisme: null, compte: c.id, montant: mr.vide ? null : mr.valeur });
      } else {
        if (source.length > LONGUEUR_ORGANISME) {
          return erreur(`remboursement ${k + 1} : organisme de plus de ${LONGUEUR_ORGANISME} caractères`);
        }
        rembs.push({ type: 'organisme', organisme: source, compte: null, montant: mr.vide ? null : mr.valeur });
      }
    }
    if (rembs.filter(r => r.montant === null).length > 1) {
      return erreur('un seul remboursement peut avoir un montant vide (= le reste)');
    }
    const fixe = rembs.reduce((s, r) => s + (r.montant ?? 0), 0);
    if (montant !== null && fixe > montant) return erreur('les remboursements dépassent le montant');
    if (compte.type === TYPE_EXTERNE && (rembs.length === 0 || rembs.some(r => r.type !== 'compte'))) {
      return erreur(`dépense avancée par ${compte.nom} : elle doit être remboursée par un de tes comptes`);
    }

    return { compte: compte.id, rubrique: rub.id, detail, montant, rembs };
  }

  // ---------- Lecture du collage ----------
  function lire(texte, avecEntetes) {
    const separateur = texte.includes('\t') ? '\t' : ';';
    const lignes = [];
    const erreurs = [];
    const vues = new Set(); // doublons à l'intérieur du collage

    texte.split(/\r?\n/).forEach((brute, i) => {
      const numero = i + 1;
      if (avecEntetes && i === 0) return;
      const cellules = brute.split(separateur)
        .map(c => c.replace(/^"|"$/g, '').trim().replace(/\s+/g, ' '));
      while (cellules.length > 0 && cellules[cellules.length - 1] === '') cellules.pop();
      if (cellules.length === 0) return;
      if (cellules.length > COLONNES.length) {
        erreurs.push({ numero, raison: `plus de ${COLONNES.length} colonnes` });
        return;
      }
      const r = analyserLigne(cellules);
      if (r.erreur) {
        erreurs.push({ numero, raison: r.erreur });
        return;
      }
      const k = cle(r.compte, r.rubrique, r.detail);
      if (vues.has(k)) {
        erreurs.push({ numero, raison: 'doublon d\'une ligne précédente du collage' });
        return;
      }
      vues.add(k);
      lignes.push({ numero, ...r, existe: existantes.has(k) });
    });
    return { lignes, erreurs };
  }

  // ---------- Aperçu ----------
  function cellule(texte, classe) {
    const td = document.createElement('td');
    td.textContent = texte;
    if (classe) td.className = classe;
    return td;
  }
  const texteRembs = r => r.rembs.map(x =>
    `${x.type === 'organisme' ? x.organisme : nomCompte(x.compte)} ` +
    `${x.montant !== null ? euros(x.montant) : '(le reste)'}`).join(', ') || '—';

  function dessiner() {
    const texte = $('collage').value;
    if (texte.trim() === '') {
      analyse = null;
      $('apercu').hidden = true;
      return;
    }
    analyse = lire(texte, $('entetes').checked);
    const nouvelles = analyse.lignes.filter(l => !l.existe);
    $('apercu').hidden = false;

    let resume = `${nouvelles.length} dépense(s) rapide(s) à créer, ${analyse.lignes.length - nouvelles.length} déjà existante(s)`;
    if (analyse.erreurs.length > 0) resume += `, ${analyse.erreurs.length} ligne(s) ignorée(s)`;
    $('resume').textContent = `${resume}.`;

    $('bloc-erreurs').hidden = analyse.erreurs.length === 0;
    $('erreurs').replaceChildren(...analyse.erreurs.map(e => {
      const li = document.createElement('li');
      li.textContent = `Ligne ${e.numero} : ${e.raison}`;
      return li;
    }));

    $('liste').replaceChildren(...analyse.lignes.map(l => {
      const tr = document.createElement('tr');
      tr.append(
        cellule(String(l.numero)),
        cellule(l.detail || chemin(l.rubrique)),
        cellule(nomCompte(l.compte)),
        cellule(chemin(l.rubrique)),
        cellule(l.montant !== null ? euros(l.montant) : 'À saisir', 'num'),
        cellule(texteRembs(l)),
        cellule(l.existe ? 'Existe déjà' : 'Nouvelle', l.existe ? 'discret' : 'statut-nouvelle'));
      return tr;
    }));

    $('importer').textContent = `Importer ${nouvelles.length} dépense(s) rapide(s)`;
    $('importer').disabled = nouvelles.length === 0;
  }

  // ---------- Import ----------
  async function importer() {
    if (!analyse) return;
    const nouvelles = analyse.lignes.filter(l => !l.existe);
    if (nouvelles.length === 0) return;

    let question = `Créer ${nouvelles.length} dépense(s) rapide(s) ?`;
    if (analyse.erreurs.length > 0) question += `\n\n${analyse.erreurs.length} ligne(s) en erreur seront ignorées.`;
    if (!confirm(question)) return;

    try {
      db.executer('BEGIN');
      for (const l of nouvelles) {
        db.executer('INSERT INTO depenses_rapides (compte_id, rubrique_id, detail, montant) VALUES (?, ?, ?, ?)',
                    [l.compte, l.rubrique, l.detail, l.montant]);
        const id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
        l.rembs.forEach((r, k) => db.executer(
          `INSERT INTO depenses_rapides_remb (depense_rapide_id, type, organisme, compte_id, montant, ordre)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, r.type, r.organisme, r.compte, r.montant, k + 1]));
      }
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Import impossible, aucune dépense rapide créée : ${e.message}`, 'erreur');
    }

    afficherImportRapides(conteneur); // repart d'une page vide
    try {
      await db.enregistrer();
      message(`${nouvelles.length} dépense(s) rapide(s) importée(s) et enregistrée(s).`, 'succes');
    } catch (e) {
      message(`Dépenses rapides importées, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
  }

  // ---------- Branchements ----------
  $('copier-entetes').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(COLONNES.join('\t'));
      message('En-têtes copiés : colle-les en A1 dans Excel.', 'succes');
    } catch {
      message("Copie impossible : le navigateur a refusé l'accès au presse-papiers.", 'erreur');
    }
  });
  $('collage').addEventListener('input', () => {
    if (!entetesModifie) { // détection automatique de la ligne d'en-têtes
      const premiere = normaliser($('collage').value.split(/\r?\n/)[0] ?? '');
      $('entetes').checked = /\bniveau\b|\bmontant\b/.test(premiere);
    }
    dessiner();
  });
  $('entetes').addEventListener('change', () => { entetesModifie = true; dessiner(); });
  $('importer').addEventListener('click', importer);
}