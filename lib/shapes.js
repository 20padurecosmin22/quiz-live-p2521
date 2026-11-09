// Fiecare variantă de răspuns are culoare, formă și literă,
// astfel încât să poată fi recunoscută și fără culori (vezi lecția despre accesibilitate).

export const OPTIONS = [
  { letter: 'A', name: 'triunghi', cls: 'opt-a' },
  { letter: 'B', name: 'romb', cls: 'opt-b' },
  { letter: 'C', name: 'cerc', cls: 'opt-c' },
  { letter: 'D', name: 'pătrat', cls: 'opt-d' },
];

export function Shape({ index, size = 28 }) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true };
  const fill = 'currentColor';
  if (index === 0) return <svg {...common}><polygon points="16,3 30,28 2,28" fill={fill} /></svg>;
  if (index === 1) return <svg {...common}><polygon points="16,2 30,16 16,30 2,16" fill={fill} /></svg>;
  if (index === 2) return <svg {...common}><circle cx="16" cy="16" r="13" fill={fill} /></svg>;
  return <svg {...common}><rect x="4" y="4" width="24" height="24" fill={fill} /></svg>;
}
