import * as db from '../db.js';
import { euros } from '../outils.js';

// lien: null = fonction pas encore développée
const FONCTIONS = [
  { icone: '🏦', titre: 'Gérer les comptes',           lien: '#/comptes' },
  { icone: '🗂️', titre: 'Gérer les rubriques',         lien: '#/rubriques' },
  { icone: '✍️', titre: 'Nouvelle dépense',            lien: '#/operation' },
  { icone: '⚡', titre: 'Dépense rapide',              lien: null },
  { icone: '📥', titre: 'Importer un relevé bancaire', lien: null },
  { icone: '📅', titre: 'Préparer une nouvelle année', lien: null },
];

function creer(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

function carte(compte, principal) {
  const div = creer('div', principal ? 'carte principale' : 'carte');
  div.append(
    creer('div', 'nom', compte.nom),
    creer('div', compte.solde < 0 ? 'montant negatif' : 'montant', euros(compte.solde))
  );
  return div;
}

export function afficherAccueil(conteneur) {
  // Structure fixe uniquement : les données sont insérées avec textContent
  conteneur.innerHTML = `
    <section>
      <h2>Soldes actuels</h2>
      <p class="message" data-ref="vide" hidden>Aucun compte actif. Commence par « Gérer les comptes ».</p>
      <div class="groupes" data-ref="groupes"></div>
    </section>
    <section>
      <h2>Fonctions</h2>
      <div class="tuiles" data-ref="tuiles"></div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // Solde = solde initial + opérations réalisées après la date du solde initial
  const comptes = db.lire(`
    SELECT c.id, c.nom, c.type, c.compte_rattachement_id,
           c.solde_initial + COALESCE(SUM(o.montant_total), 0) AS solde
    FROM comptes c
    LEFT JOIN operations o
           ON o.compte_id = c.id
          AND o.statut = 'realisee'
          AND (c.date_solde_initial IS NULL OR o.date_banque > c.date_solde_initial)
    WHERE c.actif = 1 AND c.type <> 'Externe'
    GROUP BY c.id
    ORDER BY c.ordre_affichage, c.nom`);

  // Un groupe par compte courant actif, puis ses comptes épargne
  const groupes = new Map();
  for (const c of comptes) {
    if (c.type === 'Courant') groupes.set(c.id, { titre: c.nom, comptes: [c], orphelin: false });
  }
  const orphelins = { titre: 'Non rattachés', comptes: [], orphelin: true };
  for (const c of comptes) {
    if (c.type === 'Courant') continue;
    (groupes.get(c.compte_rattachement_id) ?? orphelins).comptes.push(c);
  }
  const liste = [...groupes.values()];
  if (orphelins.comptes.length > 0) liste.push(orphelins);

  $('vide').hidden = liste.length > 0;

  for (const g of liste) {
    const total = g.comptes.reduce((somme, c) => somme + c.solde, 0);

    const bloc = creer('div', g.orphelin ? 'groupe orphelin' : 'groupe');
    const entete = creer('div', 'entete-groupe');
    entete.append(
      creer('h3', null, g.titre),
      creer('span', total < 0 ? 'total-groupe negatif' : 'total-groupe', euros(total))
    );
    bloc.append(entete);

    if (g.orphelin) {
      bloc.append(creer('p', 'discret', 'Rattache ces comptes à un compte courant dans « Gérer les comptes ».'));
    }

    const cartes = creer('div', 'cartes');
    g.comptes.forEach((c, i) => cartes.append(carte(c, !g.orphelin && i === 0)));
    bloc.append(cartes);
    $('groupes').append(bloc);
  }

  // Tuiles
  for (const f of FONCTIONS) {
    const tuile = creer(f.lien ? 'a' : 'div', f.lien ? 'tuile' : 'tuile bientot');
    if (f.lien) tuile.href = f.lien;
    else tuile.setAttribute('aria-disabled', 'true');

    const icone = creer('span', 'icone', f.icone);
    icone.setAttribute('aria-hidden', 'true');
    tuile.append(icone, creer('strong', null, f.titre));
    if (!f.lien) tuile.append(creer('span', 'badge', 'Bientôt'));
    $('tuiles').append(tuile);
  }
}