#!/usr/bin/env node
const fs = require('fs');
const FILE = 'C:/dev/desafio-21-dias/site/wpktavares-site/public/admin/index.html';
let src = fs.readFileSync(FILE, 'utf8');
const MAP = {
  '🎯': 'crosshair',
  '🛒': 'shopping-cart',
  '⭐': 'star',
  '🧪': 'flask-conical',
  '🔌': 'plug',
  '🎨': 'palette',
  '🎉': 'party-popper',
  '🏷':  'tag',
  '🏷️': 'tag',
  '🟡': 'circle',
  '⬜': 'square',
  '📤': 'send',
};
let c = 0;
for (const [e, l] of Object.entries(MAP)) {
  const escaped = e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const m = src.match(re);
  if (m) { c += m.length; src = src.replace(re, '<i data-lucide="' + l + '" class="luc"></i>'); }
}
fs.writeFileSync(FILE, src);
console.log('Mais ' + c + ' substituidos.');