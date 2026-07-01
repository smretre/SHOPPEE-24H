const { schedule } = require('@netlify/functions');
const axios = require('axios');
const crypto = require('crypto');

const APP_ID = process.env.SHOPEE_APP_ID;
const APP_SECRET = process.env.SHOPEE_APP_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const mineradorHandler = async (event) => {
    try {
        // --- BLOQUEIO DE HORÁRIO (Economia de Netlify) ---
        const agora = new Date();
        // Ajuste para Brasília (UTC-3). 
        // Se o servidor estiver em UTC, subtraímos 3 horas.
        const horaBrasilia = agora.getUTCHours() - 3;
        const horaReal = horaBrasilia < 0 ? horaBrasilia + 24 : horaBrasilia;

        console.log(`Verificando horário: ${horaReal}h`);

        // Para entre 23h e 06:59h
        if (horaReal >= 23 || horaReal < 7) {
            console.log("Horário de silêncio. Encerrando para economizar requisições.");
            return { statusCode: 200, body: "Robô em modo de descanso." };
        }

        // --- INÍCIO DA EXECUÇÃO ---
        console.log("Iniciando mineração...");
        const ofertas = await buscarOfertasEmAlta();
        
        if (!ofertas || ofertas.length === 0) {
            return { statusCode: 200, body: "Sem ofertas no momento." };
        }

        for (const item of ofertas.slice(0, 3)) {
            const linkCurto = await converterParaAfiliado(item.item_url);
            const precoAtual = Number(item.price).toFixed(2).replace('.', ',');

            const legenda = 
                ` **${item.item_name}**\n\n` +
                `💰 **Preço: R$ ${precoAtual}**\n\n` +
                `🔥 *Oferta por tempo limitado!*\n\n` +
                `🛒 **COMPRE AQUI:** ${linkCurto}`;

            await enviarTelegramComFoto(item.image_url, legenda);
            // Delay de 3 segundos entre posts para evitar SPAM no Telegram
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        return { statusCode: 200, body: "Postado com sucesso!" };
    } catch (error) {
        console.error("Erro:", error.message);
        return { statusCode: 500, body: error.toString() };
    }
};

async function buscarOfertasEmAlta() {
    const timestamp = Math.floor(Date.now() / 1000);
    const queryObj = {
        query: "query{productOfferV2(listType:0,sortType:2,page:0,limit:5){nodes{productName,productLink,price,imageUrl}}}",
        variables: null,
        operationName: null
    };
    
    const payload = JSON.stringify(queryObj);
    const signature = crypto.createHash('sha256').update(APP_ID + timestamp + payload + APP_SECRET).digest('hex');

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", queryObj, { 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` 
            } 
        });

        const nodes = res.data?.data?.productOfferV2?.nodes || [];
        return nodes.map(n => ({
            item_name: n.productName,
            item_url: n.productLink,
            price: parseFloat(n.price),
            image_url: n.imageUrl
        }));
    } catch (error) {
        return [];
    }
}

async function converterParaAfiliado(url) {
    const timestamp = Math.floor(Date.now() / 1000);
    const queryObj = {
        query: `mutation{generateShortLink(input:{originUrl:"${url}"}){shortLink}}`,
        variables: null,
        operationName: null
    };
    
    const payload = JSON.stringify(queryObj);
    const signature = crypto.createHash('sha256').update(APP_ID + timestamp + payload + APP_SECRET).digest('hex');

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", queryObj, { 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` 
            } 
        });
        return res.data?.data?.generateShortLink?.shortLink || url;
    } catch (e) {
        return url;
    }
}

async function enviarTelegramComFoto(urlImagem, legenda) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
    await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        photo: urlImagem,
        caption: legenda,
        parse_mode: "Markdown"
    });
}

module.exports.handler = schedule("0 * * * *", mineradorHandler);
