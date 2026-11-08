export function message(texte, type = 'info') {
  const zone = document.getElementById('message');
  zone.textContent = texte;
  zone.className = `message ${type}`;
}

// 125050 → "1 250,50 €"
export function euros(centimes) {
  return (centimes / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

// "1 250,50" → 125050 ; vide → 0 ; invalide → null
export function lireMontant(texte) {
  const t = texte.replace(/\s/g, '').replace(',', '.');
  if (t === '') return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

// 125050 → "1250,50" (pour pré-remplir un champ)
export function montantPourSaisie(centimes) {
  return (centimes / 100).toFixed(2).replace('.', ',');
}

// "2026-11-06" → "06/11/2026"
export function dateFr(iso) {
  if (!iso) return '—';
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

// "Santé " → "sante" : comparaison sans accents ni majuscules
export const normaliser = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();