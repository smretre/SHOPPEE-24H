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
        const agora = new Date();
        // Ajuste para Brasília (UTC-3). 
        const horaBrasilia = agora.getUTCHours() - 3;
        const horaReal = horaBrasilia < 0 ? horaBrasilia + 24 : horaBrasilia;

        console.log(`Verificando horário: ${horaReal}h`);

        // Para entre 23h e 06:59h
        if (horaReal >= 23 || horaReal < 7) {
            console.log("Horário de silêncio. Encerrando para economizar requisições.");
            return { statusCode: 200, body: "Robô em modo de descanso." };
        }
        console.log("Iniciando mineração com imagens...");

        const ofertas = await buscarOfertasEmAlta();
        
        if (!ofertas || ofertas.length === 0) {
            console.log("Nenhuma oferta encontrada no momento.");
            return { statusCode: 200 };
        }

        // EMBARALHAMENTO SEGURO: Mistura as 20 ofertas recebidas para evitar postar na mesma sequência
        const ofertasEmbaralhadas = ofertas.sort(() => Math.random() - 0.5);

        for (const item of ofertasEmbaralhadas.slice(0, 3)) {
            if (!item.item_url) continue;

            // Obtém o link convertido
            let linkCurto = await converterParaAfiliado(item.item_url);
            
            // AJUSTE DE SEGURANÇA: Se o link encurtado falhar, usa o link original para não quebrar o Telegram
            if (!linkCurto || typeof linkCurto !== 'string' || !linkCurto.startsWith('http')) {
                linkCurto = item.item_url;
            }

            const precoAtual = item.price ? Number(item.price).toFixed(2).replace('.', ',') : "0,00";
            const precoAntigo = item.old_price ? Number(item.old_price).toFixed(2).replace('.', ',') : precoAtual;
            const rating = item.item_rating ? Number(item.item_rating).toFixed(1) : "5.0";

            let blocoPreco = `✅ **Por: R$ ${precoAtual}**`;
            if (item.old_price && item.old_price > item.price) {
                blocoPreco = `❌ De:  R$ ${precoAntigo}\n\n✅ **Por: R$ ${precoAtual}**`;
            }
            
            const legenda = 
                `📦 **${item.item_name || 'Produto Especial'}**\n\n` +
                `${blocoPreco}\n\n` +
                `⭐ Avaliação: ${rating} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n`;

            if (item.image_url) {
                try {
                    await enviarTelegramComFoto(item.image_url, legenda, linkCurto);
                    console.log(`[Telegram] Postado com sucesso: ${item.item_name?.substring(0, 25)}...`);
                } catch (telegramErr) {
                    console.error("[Telegram] Erro ao enviar este produto:", telegramErr.message);
                }
            }
            
            // Delay de 3 segundos entre posts para o Telegram não dar block por spam
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
    
    const temas = [
        "eletronicos", "relogio inteligente", "fone bluetooth", "casa e cozinha", 
        "organizador", "acessorios celular", "setup gamer", "achadinhos",
        "tecnologia", "moda", "camisa", "seleção", "kit upgrade", "ferramentas"
    ];   
    const termoSorteado = temas[Math.floor(Math.random() * temas.length)];
    console.log(`[Shopee] Buscando com segurança via variáveis para: "${termoSorteado}"`);

    const queryObj = {
        query: "query($keyword: String){productOffer(keyword:$keyword,page:1,limit:20){nodes{productName,productLink,price,priceMax,imageUrl}}}",
        variables: {
            keyword: termoSorteado
        },
        operationName: null
    };
    
    const payload = JSON.stringify(queryObj);
    const signature = crypto.createHash('sha256')
        .update(APP_ID + timestamp + payload + APP_SECRET)
        .digest('hex');

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", 
            queryObj, 
            { 
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` 
                } 
            }
        );

        const nodes = res.data?.data?.productOffer?.nodes || [];
        return nodes.map(n => ({
            item_name: n.productName,
            item_url: n.productLink,
            price: parseFloat(n.price),
            old_price: parseFloat(n.priceMax || n.price),
            image_url: n.imageUrl,
            item_rating: 5
        }));

    } catch (error) {
        console.error("Erro na Requisição da Shopee:", error.response?.data || error.message);
        return [];
    }
}

async function converterParaAfiliado(url) {
    const timestamp = Math.floor(Date.now() / 1000);
    
    const queryObj = {
        query: "mutation($link: String!){generateShortLink(input:{originUrl:$link}){shortLink}}",
        variables: {
            link: url
        },
        operationName: null
    };
    
    const payload = JSON.stringify(queryObj);
    const signature = crypto.createHash('sha256')
        .update(APP_ID + timestamp + payload + APP_SECRET)
        .digest('hex');

    try {
        const res = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", queryObj, { 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}` 
            } 
        });
        
        if (res.data?.errors) {
            console.error("[Shopee Link] Erro retornado pela API:", JSON.stringify(res.data.errors));
            return url;
        }

        return res.data?.data?.generateShortLink?.shortLink || url;
    } catch (e) {
        console.error("[Shopee Link] Erro crítico na requisição de link:", e.message);
        return url;
    }
}

async function enviarTelegramComFoto(urlImagem, legenda, linkCurto) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
    await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        photo: urlImagem,
        caption: legenda,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔥 COMPRAR AGORA",
                url: linkCurto
              }
            ]
          ]
        }
    });
}

// AJUSTE IMPORTANTE: Mude para "*/30 * * * *" em produção para evitar bloqueios por excesso de chamadas na API da Shopee!
module.exports.handler = schedule("* * * * *", mineradorHandler);
                
