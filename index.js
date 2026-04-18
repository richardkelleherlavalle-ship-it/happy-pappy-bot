const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let ultimoQR = '';

app.get('/qr', async (req, res) => {
  if (!ultimoQR) {
    return res.send('<h2 style="color:white">QR no disponible aún, espera unos segundos y recarga</h2>');
  }
  const qrImagen = await QRCode.toDataURL(ultimoQR);
  res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111">
    <img src="${qrImagen}" style="width:300px;height:300px"/>
  </body></html>`);
});

app.get('/', (req, res) => {
  res.send('<h2 style="color:white;background:#111;padding:20px">Happy Pappy Bot 🍔 funcionando</h2>');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor HTTP corriendo');
});

const CATEGORIAS = {
  'COMPRA INSUMOS': 'COMPRA INSUMOS',
  'RENTA': 'RENTA',
  'LUZ': 'LUZ',
  'AGUA': 'AGUA',
  'SUELDOS': 'SUELDOS',
  'INTERNET': 'INTERNET',
  'GAS': 'GAS',
  'GASOLINA': 'GASOLINA',
  'REPARACIONES': 'REPARACIONES Y MANTENIMIENTO',
  'LIMPIEZA': 'SUMINISTROS DE LIMPIEZA',
  'EMPAQUES': 'EMPAQUES Y BOLSAS',
  'REPARTIDOR': 'PAGO DE REPARTIDOR',
  'IMPREVISTOS': 'IMPREVISTOS',
  'ADS': 'ADS',
  'SOFTWARE': 'SOFTWARE',
  'CREDITO': 'CREDITO',
  'IMPUESTOS': 'IMPUESTOS'
};

const GRUPOS = {
  campeche: process.env.GRUPO_CAMPECHE_ID || '',
  merida: process.env.GRUPO_MERIDA_ID || ''
};

function parsearMensaje(texto) {
  if (!texto.startsWith('/gasto')) return null;

  const contenido = texto.replace('/gasto', '').trim();
  const partes = contenido.split('|').map(p => p.trim());

  if (partes.length < 3) return null;

  const categoriaRaw = partes[0].toUpperCase();
  const concepto = partes[1];
  const monto = parseFloat(partes[2]);
  const metodoPago = partes[3] ? partes[3].toUpperCase() : 'EFECTIVO';

  if (!concepto || isNaN(monto) || monto <= 0) return null;

  const categoria = CATEGORIAS[categoriaRaw] || 'IMPREVISTOS';

  return { categoriaRaw, categoria, concepto, monto, metodoPago };
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  console.log('QR generado — visita /qr para escanearlo');
  qrcode.generate(qr, { small: true });
  ultimoQR = qr;
});

client.on('ready', () => {
  console.log('✅ Bot conectado y listo');
  ultimoQR = '';
  client.getChats().then(chats => {
    const grupos = chats.filter(c => c.isGroup);
    console.log('\n📋 GRUPOS DISPONIBLES:');
    grupos.forEach(g => console.log(`${g.name} → ID: ${g.id._serialized}`));
  });
});

client.on('message', async (message) => {
  try {
    const chat = await message.getChat();
    if (!chat.isGroup) return;

    const groupId = chat.id._serialized;

    let restaurante = null;
    if (GRUPOS.campeche && groupId === GRUPOS.campeche) restaurante = 'campeche';
    if (GRUPOS.merida && groupId === GRUPOS.merida) restaurante = 'merida';
    if (!restaurante) return;

    const texto = message.body.trim();

    if (texto.toLowerCase() === '/ayuda') {
      await message.reply(
        `📋 *FORMATO PARA REGISTRAR GASTO:*\n\n` +
        `/gasto CATEGORIA | CONCEPTO | MONTO | METODO\n\n` +
        `*Categorías:*\nCOMPRA INSUMOS, RENTA, LUZ, AGUA, SUELDOS, INTERNET, GAS, GASOLINA, REPARACIONES, LIMP
