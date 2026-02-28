const { schedule } = require('@netlify/functions');
const axios = require('axios');
const crypto = require('crypto');

// Variáveis de ambiente
const APP_ID = process.env.SHOPEE_APP_ID;
const APP_SECRET = process.env.SHOPEE_APP_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Função principal que o Cron executa
const mineradorHandler = async (event) => {
    try {
        console.log("Iniciando mineração com imagens...");

        const ofertas = await buscarOfertasEmAlta();
        
        if (!ofertas || ofertas.length === 0) {
            console.log("Nenhuma oferta encontrada no momento.");
            return { statusCode: 200 };
        }

        for (const item of ofertas.slice(0, 3)) {
            const linkCurto = await converterParaAfiliado(item.item_url);
            
            const legenda = 
                `📦 **${item.item_name}**\n\n` +
                `💰 **Preço: R$ ${(item.price / 100).toFixed(2)}**\n` +
                `⭐ Avaliação: ${item.item_rating.toFixed(1)} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n\n` +
                `🛒 **COMPRE AQUI:** ${linkCurto}`;

            await enviarTelegramComFoto(item.image_url, legenda);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Postado com sucesso!" }) };
    } catch (error) {
        console.error("Erro no Minerador:", error.message);
        return { statusCode: 500, body: error.toString() };
    }
};

// --- Funções de API ---

async function buscarOfertasEmAlta() {
    const timestamp = Math.floor(Date.now() / 1000);
    const query = `{
        getItemList(page: 1, pageSize: 5, region: "BR") {
            nodes {
                item_name
                item_url
                price
                item_rating
                image_url 
            }
        }
    }`;

    const signature = gerarAssinatura(query, timestamp);
    const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", 
        { query }, 
        { headers: { 'Authorization': `SHA256 AppID=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` } }
    );

    return res.data?.data?.getItemList?.nodes || [];
}

async function converterParaAfiliado(url) {
    const timestamp = Math.floor(Date.now() / 1000);
    const query = `mutation { generateShortLink(input: { originUrl: "${url}" }) { shortLink } }`;
    const signature = gerarAssinatura(query, timestamp);

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", 
            { query }, 
            { headers: { 'Authorization': `SHA256 AppID=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` } }
        );
        return res.data?.data?.generateShortLink?.shortLink || url;
    } catch (e) {
        return url;
    }
}

function gerarAssinatura(payload, ts) {
    return crypto.createHash('sha256').update(APP_ID + ts + payload + APP_SECRET).digest('hex');
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

// Exportação obrigatória para o agendamento da Netlify
module.exports.handler = schedule("0 * * * *", mineradorHandler);
        
