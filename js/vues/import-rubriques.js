import * as db from '../db.js';
import { message, normaliser } from '../outils.js';

// ⚠️ Les valeurs doivent être identiques à celles du CHECK de schema.sql (colonne nature)
const NATURES = [
  { valeur: 'depense',  libelle: 'Dépense' },
  { valeur: 'revenu',   libelle: 'Revenu' },
  { valeur: 'virement', libelle: 'Virement' },
];
const NIVEAU_MAX = 3;
const LONGUEUR_MAX = 60;

// Nature proposée par défaut pour une nouvelle rubrique de niveau 1
function devinerNature(nom) {
  const n = normaliser(nom);
  if (/entree|revenu|salaire|recette/.test(n)) return 'revenu';
  if (/virement|transfert/.test(n)) return 'virement';
  return 'depense';
}

// ---------- 1. Lecture du texte collé ----------
// Excel sépare les colonnes par des tabulations (on accepte aussi le point-virgule)
function lireCollage(texte, avecEntetes, recopier) {
  const separateur = texte.includes('\t') ? '\t' : ';';
  const lignes = [];
  const erreurs = [];
  let precedente = [];

  texte.split(/\r?\n/).forEach((brute, i) => {
    const numero = i + 1;
    if (avecEntetes && i === 0) return;

    const cellules = brute.split(separateur)
      .map(c => c.replace(/^"|"$/g, '').trim().replace(/\s+/g, ' '));
    while (cellules.length > 0 && cellules[cellules.length - 1] === '') cellules.pop();
    if (cellules.length === 0) return; // ligne vide

    if (cellules.length > NIVEAU_MAX) {
      erreurs.push({ numero, raison: `plus de ${NIVEAU_MAX} niveaux` });
      return;
    }
    // Cellules fusionnées : une case vide reprend la valeur de la ligne du dessus
    if (recopier) {
      for (let k = 0; k < cellules.length - 1; k++) {
        if (cellules[k] === '') cellules[k] = precedente[k] ?? '';
      }
    }
    if (cellules.some(c => c === '')) {
      erreurs.push({ numero, raison: 'case vide avant le dernier niveau' });
      return;
    }
    const tropLong = cellules.find(c => c.length > LONGUEUR_MAX);
    if (tropLong) {
      erreurs.push({ numero, raison: `« ${tropLong.slice(0, 30)}… » dépasse ${LONGUEUR_MAX} caractères` });
      return;
    }
    precedente = cellules;
    lignes.push({ numero, cellules });
  });
  return { lignes, erreurs };
}

// ---------- 2. Comparaison avec les rubriques existantes ----------
function planifier(lignes, erreurs) {
  const cleExistante = (parentId, nom) => `${parentId ?? 0}|${normaliser(nom)}`;
  const index = new Map(
    db.lire('SELECT id, nom, niveau, parent_id, actif FROM rubriques')
      .map(r => [cleExistante(r.parent_id, r.nom), r]));

  const noeuds = new Map(); // chemin normalisé → nœud (les parents passent avant les enfants)

  for (const { numero, cellules } of lignes) {
    const chaine = [];
    let parent = null;
    let erreur = null;

    for (let k = 0; k < cellules.length; k++) {
      const cle = cellules.slice(0, k + 1).map(normaliser).join('\u0001');
      let noeud = noeuds.get(cle);
      if (!noeud) {
        // On ne cherche dans la base que si le parent existe déjà (ou pour un niveau 1)
        const existante = parent === null
          ? index.get(cleExistante(null, cellules[k]))
          : parent.existante ? index.get(cleExistante(parent.existante.id, cellules[k])) : undefined;
        if (!existante && parent?.existante && !parent.existante.actif) {
          erreur = `la rubrique « ${parent.chemin} » est inactive`;
          break;
        }
        noeud = {
          cle,
          nom: cellules[k],
          niveau: k + 1,
          chemin: cellules.slice(0, k + 1).join(' › '),
          parent,
          existante: existante ?? null,
        };
      }
      chaine.push(noeud);
      parent = noeud;
    }

    if (erreur) {
      erreurs.push({ numero, raison: erreur });
      continue;
    }
    for (const n of chaine) if (!noeuds.has(n.cle)) noeuds.set(n.cle, n);
  }

  erreurs.sort((a, b) => a.numero - b.numero);
  return { noeuds, erreurs };
}

// ---------- 3. Vue ----------
export function afficherImportRubriques(conteneur) {
  const natures = new Map(); // nature choisie pour chaque nouveau N1
  const natureDe = n => natures.get(n.cle) ?? devinerNature(n.nom);
  let analyse = null;
  let entetesModifie = false; // l'utilisateur a-t-il touché la case « en-têtes » ?

  conteneur.innerHTML = `
    <p><a href="#/rubriques" class="retour">← Retour aux rubriques</a></p>
    <section>
      <h2>Importer des rubriques depuis Excel</h2>
      <p class="discret">
        Dans Excel, sélectionne les colonnes Niveau 1, Niveau 2 et Niveau 3 (une rubrique par ligne),
        copie-les avec Ctrl + C, puis colle-les ci-dessous avec Ctrl + V.
        Les rubriques qui existent déjà sont réutilisées : elles ne sont jamais créées en double.
      </p>
      <label>Données copiées depuis Excel
        <textarea data-ref="collage" rows="10" spellcheck="false"
                  placeholder="Courses → Alimentation → Biocoop (une colonne par niveau)"></textarea>
      </label>
      <div class="options">
        <label class="case"><input type="checkbox" data-ref="entetes"> La première ligne contient les en-têtes</label>
        <label class="case"><input type="checkbox" data-ref="recopier" checked> Recopier les cases vides depuis la ligne du dessus (cellules fusionnées)</label>
      </div>
    </section>
    <section data-ref="apercu" hidden>
      <h2>Aperçu</h2>
      <p data-ref="resume" aria-live="polite"></p>
      <div data-ref="bloc-natures" hidden>
        <h3>Nature des nouvelles rubriques de niveau 1</h3>
        <div class="natures" data-ref="natures"></div>
      </div>
      <div data-ref="bloc-erreurs" hidden>
        <h3>Lignes ignorées</h3>
        <ul class="erreurs" data-ref="erreurs"></ul>
      </div>
      <div class="defilement apercu-liste">
        <table>
          <thead><tr><th>Rubrique</th><th>Niveau</th><th>Statut</th></tr></thead>
          <tbody data-ref="liste"></tbody>
        </table>
      </div>
      <div class="boutons-form">
        <button type="button" data-ref="importer">Importer</button>
      </div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  function cellule(texte, classe) {
    const td = document.createElement('td');
    td.textContent = texte;
    if (classe) td.className = classe;
    return td;
  }

  function dessiner() {
    const texte = $('collage').value;
    if (texte.trim() === '') {
      analyse = null;
      $('apercu').hidden = true;
      return;
    }
    const { lignes, erreurs } = lireCollage(texte, $('entetes').checked, $('recopier').checked);
    analyse = planifier(lignes, erreurs);

    const tous = [...analyse.noeuds.values()];
    const nouvelles = tous.filter(n => !n.existante);
    $('apercu').hidden = false;

    // Résumé
    let resume = `${nouvelles.length} rubrique(s) à créer, ${tous.length - nouvelles.length} déjà existante(s)`;
    if (analyse.erreurs.length > 0) resume += `, ${analyse.erreurs.length} ligne(s) ignorée(s)`;
    $('resume').textContent = `${resume}.`;

    // Natures des nouveaux N1
    const nouveauxN1 = nouvelles.filter(n => n.niveau === 1);
    $('bloc-natures').hidden = nouveauxN1.length === 0;
    $('natures').replaceChildren(...nouveauxN1.map(n => {
      const label = document.createElement('label');
      label.textContent = n.nom;
      const select = document.createElement('select');
      for (const nat of NATURES) {
        const option = document.createElement('option');
        option.value = nat.valeur;
        option.textContent = nat.libelle;
        select.append(option);
      }
      select.value = natureDe(n);
      select.addEventListener('change', () => natures.set(n.cle, select.value));
      label.append(select);
      return label;
    }));

    // Erreurs
    $('bloc-erreurs').hidden = analyse.erreurs.length === 0;
    $('erreurs').replaceChildren(...analyse.erreurs.map(e => {
      const li = document.createElement('li');
      li.textContent = `Ligne ${e.numero} : ${e.raison}`;
      return li;
    }));

    // Arbre trié : chaque rubrique suivie de ses sous-rubriques
    const tries = [...tous].sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
    $('liste').replaceChildren(...tries.map(n => {
      const tr = document.createElement('tr');
      tr.className = `niveau-${n.niveau}`;
      const tdNom = cellule(n.nom);
      tdNom.style.paddingLeft = `${0.5 + (n.niveau - 1) * 1.5}em`;
      let statut = 'Nouvelle';
      if (n.existante) statut = n.existante.actif ? 'Existe déjà' : 'Existe déjà (inactive)';
      tr.append(tdNom, cellule(`N${n.niveau}`), cellule(statut, n.existante ? 'discret' : 'statut-nouvelle'));
      return tr;
    }));

    $('importer').textContent = `Importer ${nouvelles.length} rubrique(s)`;
    $('importer').disabled = nouvelles.length === 0;
  }

  async function importer() {
    if (!analyse) return;
    const nouvelles = [...analyse.noeuds.values()].filter(n => !n.existante);
    if (nouvelles.length === 0) return;

    let question = `Créer ${nouvelles.length} rubrique(s) ?`;
    if (analyse.erreurs.length > 0) question += `\n\n${analyse.erreurs.length} ligne(s) en erreur seront ignorées.`;
    if (!confirm(question)) return;

    try {
      db.executer('BEGIN');
      for (const n of nouvelles) { // les parents sont toujours créés avant leurs enfants
        const parentId = n.parent ? (n.parent.existante?.id ?? n.parent.id) : null;
        db.executer(
          'INSERT INTO rubriques (nom, niveau, parent_id, nature) VALUES (?, ?, ?, ?)',
          [n.nom, n.niveau, parentId, n.niveau === 1 ? natureDe(n) : null]);
        n.id = db.lire('SELECT last_insert_rowid() AS id')[0].id;
      }
      db.executer('COMMIT');
    } catch (e) {
      try { db.executer('ROLLBACK'); } catch { /* aucune transaction en cours */ }
      return message(`Import impossible, aucune rubrique créée : ${e.message}`, 'erreur');
    }

    afficherImportRubriques(conteneur); // repart d'une page vide
    try {
      await db.enregistrer();
      message(`${nouvelles.length} rubrique(s) importée(s) et enregistrée(s).`, 'succes');
    } catch (e) {
      message(`Rubriques importées, mais l'enregistrement du fichier a échoué : ${e.message}`, 'erreur');
    }
  }

  // ---------- Branchements ----------
  $('collage').addEventListener('input', () => {
    if (!entetesModifie) { // détection automatique de la ligne d'en-têtes
      const premiere = normaliser($('collage').value.split(/\r?\n/)[0] ?? '');
      $('entetes').checked = /niveau|rubrique|\bn ?[123]\b/.test(premiere);
    }
    dessiner();
  });
  $('entetes').addEventListener('change', () => { entetesModifie = true; dessiner(); });
  $('recopier').addEventListener('change', dessiner);
  $('importer').addEventListener('click', importer);
}