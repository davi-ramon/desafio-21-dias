#!/usr/bin/env node
// scripts/replace_emojis.js
// Substitui todos os emojis do admin/index.html por tags <i data-lucide="...">
// que serao renderizadas como SVG monocromatico pelo Lucide.

const fs = require('fs');

const FILE = 'C:/dev/desafio-21-dias/site/wpktavares-site/public/admin/index.html';

// Mapa: emoji -> icone Lucide
const MAP = {
  // Categorias mais frequentes primeiro
  '✅': 'check-circle-2',       // 10x
  '⚠':  'alert-triangle',      // 8x (com VS-16)
  '⚠️': 'alert-triangle',      // 8x (com VS-15)
  '❌': 'x-circle',             // 6x
  '✓':  'check',               // 4x
  '⚡': 'zap',                  // 4x
  '📊': 'bar-chart-3',          // 4x
  '🎓': 'graduation-cap',       // 4x
  '🏆': 'trophy',               // 4x
  '🚀': 'rocket',               // 4x
  '🎧': 'headphones',           // 3x
  '📋': 'clipboard-list',       // 3x
  '📡': 'radio',                // 3x
  '⏸':  'pause',               // 3x
  '⏸️': 'pause',
  '♻':  'refresh-ccw',         // 3x
  '♻️': 'refresh-ccw',
  '👥': 'users',                // 2x
  '🤖': 'bot',                  // 2x
  '🔔': 'bell',                 // 2x
  '✕':  'x',                   // 2x
  '⏳': 'loader',               // 2x
  '⏰': 'alarm-clock',          // 2x
  '📂': 'folder-open',          // 2x
  '💾': 'save',                 // 2x
  '🔐': 'lock',                 // 1x
  '⚙':  'settings',            // 1x
  '⚙️': 'settings',
  '🚪': 'log-out',
  '⏱':  'timer',
  '⏱️': 'timer',
  '🔍': 'search',
  '💰': 'circle-dollar-sign',
  '💲': 'dollar-sign',
  '🖱':  'mouse-pointer',
  '🖱️': 'mouse-pointer',
  '👤': 'user',
  '📱': 'smartphone',
  '💬': 'message-circle',
  '📞': 'phone',
  '✏':  'pencil',
  '✏️': 'pencil',
  '📝': 'file-edit',
  '🌐': 'globe',
  '🔗': 'link',
  '🔥': 'flame',
  '💪': 'dumbbell',
  '🧘': 'flower-2',
  '📖': 'book-open',
  '🎙':  'mic',
  '🎙️': 'mic',
  '📚': 'book-marked',
  '🟢': 'circle-check',
  '🔴': 'circle-x',
  '📈': 'trending-up',
  '📉': 'trending-down',
  '⚙️': 'settings',
  '✖':  'x',
  '✖️': 'x',
  '➕': 'plus',
  '✅': 'check-circle-2',
  '🤖': 'bot',
};

let src = fs.readFileSync(FILE, 'utf8');

const emojis = Object.keys(MAP).sort((a, b) => b.length - a.length); // mais longos primeiro (com VS-15/16)

let count = 0;
const counts = {};

for (const emoji of emojis) {
  const lucide = MAP[emoji];
  // Constroi a tag Lucide (sem prefixo de tamanho — CSS controla)
  const tag = '<i data-lucide="' + lucide + '" class="luc"></i>';
  // Substitui literalmente o emoji pela tag
  const re = new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const matches = src.match(re);
  if (matches) {
    counts[lucide] = (counts[lucide] || 0) + matches.length;
    src = src.replace(re, tag);
    count += matches.length;
  }
}

// CSS helper: garante que <i data-lucide> tenha tamanho padrao
// (Lucide injeta SVG inline, que precisa de width/height).
const CSS_LUCIDE = '<style>.luc{display:inline-block;width:1em;height:1em;vertical-align:-0.125em;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none;flex-shrink:0}</style>';
if (!src.includes(CSS_LUCIDE)) {
  src = src.replace('</head>', CSS_LUCIDE + '</head>');
}

fs.writeFileSync(FILE, src);
console.log('[OK] Substituidos ' + count + ' emojis por tags Lucide.');
console.log('Por icone:');
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k + ': ' + v));