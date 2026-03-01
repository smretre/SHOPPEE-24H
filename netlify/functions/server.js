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
            const precoFormatado = Number(item.price).toFixed(2).replace('.', ',');
            let blocoPreco = `💰 **Preço: R$ ${precoAtual}**`;
            if (item.old_price > item.price) {
                blocoPreco = `❌ De: ~~R$ ${precoAntigo}~~\n\n✅ **Por: R$ ${precoAtual}**`;
            
            const legenda = 
                ` **${item.item_name}**\n\n` +
                `${blocoPreco}\n\n` +
                `⭐ Avaliação: ${item.item_rating.toFixed(1)} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n\n` +
                `🛒 [COMPRE AQUI](${linkCurto})`;

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
    
    // 1. O Payload precisa ser um objeto JSON stringificado e sem espaços
    const queryObj = {
        query: "query{productOfferV2(listType:0,sortType:2,page:0,limit:5){nodes{productName,productLink,price,priceBeforeDiscount,imageUrl,commissionRate}}}",
        variables: null,
        operationName: null
    };
    
    const payload = JSON.stringify(queryObj);

    // 2. Gerar assinatura com o JSON completo
    const signature = crypto.createHash('sha256')
        .update(APP_ID + timestamp + payload + APP_SECRET)
        .digest('hex');

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", 
            queryObj, 
            { 
                headers: { 
                    'Content-Type': 'application/json',
                    // ATENÇÃO: Mudamos de AppID= para Credential=
                    'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` 
                } 
            }
        );

        console.log("Resposta Shopee:", JSON.stringify(res.data));
        
        // Ajuste dos nomes dos campos conforme o productOfferV2
        const nodes = res.data?.data?.productOfferV2?.nodes || [];
        return nodes.map(n => ({
            item_name: n.productName,
            item_url: n.productLink,
            price: parseFloat(n.price),
            old_price: parseFloat(n.priceBeforeDiscount || n.price),
            image_url: n.imageUrl,
            item_rating: 5 // Campo fixo pois o V2 às vezes não retorna rating direto
        }));

    } catch (error) {
        console.error("Erro na API:", error.response?.data || error.message);
        return [];
    }
}

async function converterParaAfiliado(url) {
    const timestamp = Math.floor(Date.now() / 1000);
    // Ajustado para o padrão de linha única e JSON
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
        console.error("Erro na conversão:", e.message);
        return url;
    }
}

function gerarAssinatura(payload, ts) {
    // Agora o payload já vem como string do JSON.stringify
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
        
