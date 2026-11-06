import * as db from '../db.js';
import { euros } from '../outils.js';

// lien: null = fonction pas encore développée
const FONCTIONS = [
  { icone: '🏦', titre: 'Gérer les comptes',           lien: '#/comptes' },
  { icone: '🗂️', titre: 'Gérer les rubriques',         lien: null },
  { icone: '✍️', titre: 'Nouvelle dépense',            lien: null },
  { icone: '⚡', titre: 'Dépense rapide',              lien: null },
  { icone: '📥', titre: 'Importer un relevé bancaire', lien: null },
  { icone: '📅', titre: 'Préparer une nouvelle année', lien: null },
];

export function afficherAccueil(conteneur) {
  // Structure fixe uniquement : les données sont insérées avec textContent
  conteneur.innerHTML = `
    <section>
      <h2>Soldes actuels</h2>
      <p class="message" data-ref="vide" hidden>Aucun compte actif. Commence par « Gérer les comptes ».</p>
      <div class="cartes" data-ref="cartes"></div>
      <p class="total" data-ref="total"></p>
    </section>
    <section>
      <h2>Fonctions</h2>
      <div class="tuiles" data-ref="tuiles"></div>
    </section>`;
  const $ = ref => conteneur.querySelector(`[data-ref="${ref}"]`);

  // Solde = solde initial + opérations réalisées après la date du solde initial
  const comptes = db.lire(`
    SELECT c.nom,
           c.solde_initial + COALESCE(SUM(o.montant_total), 0) AS solde
    FROM comptes c
    LEFT JOIN operations o
           ON o.compte_id = c.id
          AND o.statut = 'realisee'
          AND (c.date_solde_initial IS NULL OR o.date_banque > c.date_solde_initial)
    WHERE c.actif = 1 AND c.type <> 'Externe'
    GROUP BY c.id
    ORDER BY c.ordre_affichage, c.nom`);

  let total = 0;
  for (const c of comptes) {
    total += c.solde;
    const carte = document.createElement('div');
    carte.className = 'carte';
    const nom = document.createElement('div');
    nom.className = 'nom';
    nom.textContent = c.nom;
    const montant = document.createElement('div');
    montant.className = c.solde < 0 ? 'montant negatif' : 'montant';
    montant.textContent = euros(c.solde);
    carte.append(nom, montant);
    $('cartes').append(carte);
  }

  if (comptes.length === 0) {
    $('vide').hidden = false;
    $('total').hidden = true;
  } else {
    $('total').textContent = `Total : ${euros(total)}`;
  }

  // Tuiles
  for (const f of FONCTIONS) {
    const tuile = document.createElement(f.lien ? 'a' : 'div');
    tuile.className = f.lien ? 'tuile' : 'tuile bientot';
    if (f.lien) tuile.href = f.lien;
    else tuile.setAttribute('aria-disabled', 'true');

    const icone = document.createElement('span');
    icone.className = 'icone';
    icone.setAttribute('aria-hidden', 'true');
    icone.textContent = f.icone;
    const titre = document.createElement('strong');
    titre.textContent = f.titre;
    tuile.append(icone, titre);

    if (!f.lien) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Bientôt';
      tuile.append(badge);
    }
    $('tuiles').append(tuile);
  }
}