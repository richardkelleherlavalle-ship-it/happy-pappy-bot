const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

// IDs de los grupos autorizados — los llenamos después
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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  console.log('Escanea este QR con el celular del bot:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot conectado y listo');
  // Imprime todos los grupos para que puedas copiar los IDs
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

    // Identificar restaurante por grupo
    let restaurante = null;
    if (GRUPOS.campeche && groupId === GRUPOS.campeche) restaurante = 'campeche';
    if (GRUPOS.merida && groupId === GRUPOS.merida) restaurante = 'merida';
    if (!restaurante) return;

    const texto = message.body.trim();

    // Comando ayuda
    if (texto.toLowerCase() === '/ayuda') {
      await message.reply(
        `📋 *FORMATO PARA REGISTRAR GASTO:*\n\n` +
        `/gasto CATEGORIA | CONCEPTO | MONTO | METODO\n\n` +
        `*Categorías:*\nCOMPRA INSUMOS, RENTA, LUZ, AGUA, SUELDOS, INTERNET, GAS, GASOLINA, REPARACIONES, LIMPIEZA, EMPAQUES, REPARTIDOR, IMPREVISTOS\n\n` +
        `*Métodos Campeche:* EFECTIVO, BANORTE, FONDEADORA\n` +
        `*Métodos Mérida:* EFECTIVO, MERCADO PAGO, KUSPIT\n\n` +
        `*Ejemplo:*\n/gasto GAS | Pago gas mayo | 500 | EFECTIVO`
      );
      return;
    }

    // Parsear gasto
    const gasto = parsearMensaje(texto);
    if (!gasto) return; // Ignorar mensajes que no son gastos

    // Guardar en Supabase
    const fecha = new Date().toISOString().split('T')[0];
    const nuevoGasto = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      restaurante,
      fecha,
      concepto: gasto.concepto,
      categoria: gasto.categoria,
      proveedor: '',
      metodo_pago: gasto.metodoPago,
      monto: gasto.monto,
      timestamp: new Date().toISOString()
    };

    const { error } = await supabase.from('gastos').insert([nuevoGasto]);

    if (error) throw error;

    const emoji = restaurante === 'campeche' ? '🏖️' : '🌿';
    await message.reply(
      `✅ *Gasto registrado*\n\n` +
      `${emoji} *${restaurante.toUpperCase()}*\n` +
      `📅 ${fecha}\n` +
      `📂 ${gasto.categoria}\n` +
      `📝 ${gasto.concepto}\n` +
      `💳 ${gasto.metodoPago}\n` +
      `💰 $${gasto.monto.toFixed(2)} MXN`
    );

  } catch (error) {
    console.error('Error:', error);
    await message.reply('❌ Error al registrar el gasto. Intenta de nuevo.');
  }
});

client.initialize();
