// Substitui todos os hrefs/links Cakto de uma pagina + injeta helper Stripe
// USO: node scripts/replace_cakto_and_inject.js <file> <plan> [<plan2>]
const fs = require('fs');
const FILE = process.argv[2];
const PLANS = {
  monthly:   { planKey: 'monthly',   value: 17,  label: 'Mensal' },
  quarterly: { planKey: 'quarterly', value: 47,  label: 'Trimestral' },
  yearly:    { planKey: 'yearly',    value: 177, label: 'Anual' }
};

if (!FILE) { console.error('uso: node scripts/replace_cakto_and_inject.js <file> <plan>'); process.exit(1); }
const planKey = process.argv[3] || 'monthly';
const plan = PLANS[planKey];
if (!plan) { console.error('plan invalido'); process.exit(1); }
console.log('plan:', planKey, '(R$' + plan.value + ')');

let s = fs.readFileSync(FILE, 'utf8');
const before = s;

// 1) Substitui TODOS os hrefs de pay.cakto.com.br
// Estrategia: pegar cada <a> que tem href cakto, trocar onclick e onclick=fbq
// Mais conservador: pegar href="https://pay.cakto.com.br/qualquer-coisa"
// e substituir por href="#" + onclick Stripe.

// Padrao regex: <a href="https://pay.cakto.com.br/..." ...> onclicks presentes
// Reescreve tudo entre <a e > mantendo classes e id, mas href="#" e onclick unificado.

s = s.replace(
  /<a([^>]*?)href="https:\/\/pay\.cakto\.com\.br\/[^"]+"([^>]*?)>/g,
  function(_, before1, after1) {
    var fullAttrs = before1 + after1;
    // remove onclick= antigos (mantem classe/id)
    fullAttrs = fullAttrs.replace(/\s+onclick="[^"]*"/g, '');
    return '<a href="#"' + fullAttrs +
      ' onclick="assinarStripe(event, \'' + plan.planKey + '\', \'Desafio 21 Dias \\u2013 ' + plan.label + '\', ' + plan.value +
      '); fbq(\'track\',\'InitiateCheckout\',{content_name:\'Desafio 21 Dias \\u2013 ' + plan.label + '\',value:' + plan.value + '.00,currency:\'BRL\'}); return false;">';
  }
);

// 2) Substitui <script>var CHECKOUT = 'https://pay.cakto.com.br/...'</script> se houver
s = s.replace(/var\s+CHECKOUT\s*=\s*['"]https:\/\/pay\.cakto\.com\.br\/[^'"]+['"]/g, "var CHECKOUT = '#stripe-checkout'");

if (s !== before) {
  fs.writeFileSync(FILE, s);
  console.log('[ok] CTAs Cakto substituidos em ' + FILE);
} else {
  console.log('[info] nenhum link Cakto encontrado em ' + FILE);
}

// 3) Injeta helper (se ainda nao tiver)
require('./inject_assinar_stripe.js');
