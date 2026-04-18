const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Variables de entorno
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  'OTROS': 'IMPREVISTOS'
};

const METODOS_PAGO = {
  'campeche': ['EFECTIVO', 'BANORTE', 'FONDEADORA'],
  'merida': ['EFECTIVO', 'MERCADO PAGO', 'KUSPIT']
};

function parsearMensaje(texto) {
  // Formato esperado: CATEGORIA | CONCEPTO | MONTO | METODO
  // Ejemplo: GAS | Pago de gas mayo | 500 | EFECTIVO
  const partes = texto.split('|').map(p => p.trim());
  
  if (partes.length < 3) return null;

  const categoriaRaw = partes[0].toUpperCase();
  const concepto = partes[1];
  const monto = parseFloat(partes[2]);
  const metodoPago = partes[3] ? partes[3].toUpperCase() : 'EFECTIVO';

  if (!concepto || isNaN(monto) || monto <= 0) return null;

  // Buscar categoría
  const categoria = CATEGORIAS[categoriaRaw] || 'IMPREVISTOS';

  return { categoriaRaw, categoria, concepto, monto, metodoPago };
}

function identificarRestaurante(numero) {
  // Los números registrados por ubicación los defines aquí
  // Formato: '521XXXXXXXXXX' (52 = México)
  const NUMEROS = {
    campeche: process.env.NUMEROS_CAMPECHE ? process.env.NUMEROS_CAMPECHE.split(',') : [],
    merida: process.env.NUMEROS_MERIDA ? process.env.NUMEROS_MERIDA.split(',') : []
  };

  if (NUMEROS.campeche.includes(numero)) return 'campeche';
  if (NUMEROS.merida.includes(numero)) return 'merida';
  return null; // Número no autorizado
}

async function enviarMensaje(numero, mensaje) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: mensaje }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error enviando mensaje:', error.response?.data || error.message);
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recibir mensajes
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const message = messages[0];
    if (message.type !== 'text') {
      await enviarMensaje(message.from, '❌ Solo acepto mensajes de texto con el formato:\n\n*CATEGORIA | CONCEPTO | MONTO | METODO*\n\nEjemplo:\nGAS | Pago gas mayo | 500 | EFECTIVO');
      return;
    }

    const texto = message.text.body.trim();
    const numeroRemitente = message.from;

    // Comando de ayuda
    if (texto.toLowerCase() === 'ayuda' || texto.toLowerCase() === 'help') {
      await enviarMensaje(numeroRemitente, 
        `📋 *FORMATO PARA REGISTRAR GASTO:*\n\nCATEGORIA | CONCEPTO | MONTO | METODO\n\n*Categorías disponibles:*\nCOMPRA INSUMOS, RENTA, LUZ, AGUA, SUELDOS, INTERNET, GAS, GASOLINA, REPARACIONES, LIMPIEZA, EMPAQUES, REPARTIDOR, IMPREVISTOS\n\n*Métodos Campeche:* EFECTIVO, BANORTE, FONDEADORA\n*Métodos Mérida:* EFECTIVO, MERCADO PAGO, KUSPIT\n\n*Ejemplo:*\nGAS | Pago gas mayo | 500 | EFECTIVO`
      );
      return;
    }

    // Identificar restaurante
    const restaurante = identificarRestaurante(numeroRemitente);
    if (!restaurante) {
      await enviarMensaje(numeroRemitente, '❌ Tu número no está autorizado para registrar gastos. Contacta al administrador.');
      return;
    }

    // Parsear mensaje
    const gasto = parsearMensaje(texto);
    if (!gasto) {
      await enviarMensaje(numeroRemitente, 
        `❌ Formato incorrecto. Usa:\n\n*CATEGORIA | CONCEPTO | MONTO | METODO*\n\nEjemplo:\nGAS | Pago gas mayo | 500 | EFECTIVO\n\nEscribe *ayuda* para ver todas las categorías.`
      );
      return;
    }

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

    // Respuesta de confirmación
    const emoji = restaurante === 'campeche' ? '🏖️' : '🌿';
    const confirmacion = 
      `✅ *Gasto registrado*\n\n` +
      `${emoji} *${restaurante.toUpperCase()}*\n` +
      `📅 ${fecha}\n` +
      `📂 ${gasto.categoria}\n` +
      `📝 ${gasto.concepto}\n` +
      `💳 ${gasto.metodoPago}\n` +
      `💰 $${gasto.monto.toFixed(2)} MXN`;

    await enviarMensaje(numeroRemitente, confirmacion);

  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});

app.get('/', (req, res) => {
  res.send('Happy Pappy Bot funcionando 🍔');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
