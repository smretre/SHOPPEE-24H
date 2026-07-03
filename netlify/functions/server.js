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

        // Ajustado para pausar de verdade entre 23h e 06:59h
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

        // EVITA PRODUTOS REPETIDOS: Embaralha a lista com os 40 produtos retornados da API
        const ofertasMisturadas = ofertas.sort(() => Math.random() - 0.5);

        // Pega os 3 primeiros da lista que agora está totalmente misturada
        for (const item of ofertasMisturadas.slice(0, 3)) {
            if (!item.item_url) continue;

            let linkCurto = await converterParaAfiliado(item.item_url);
            
            // TRAVA DE SEGURANÇA: Se o encurtador falhar, usa o link original para o Telegram não dar erro 400
            if (!linkCurto || typeof linkCurto !== 'string' || !linkCurto.startsWith('http')) {
                linkCurto = item.item_url;
            }

            const precoAtual = Number(item.price).toFixed(2).replace('.', ',');
            const precoAntigo = Number(item.old_price).toFixed(2).replace('.', ',');
            
            let blocoPreco = `✅ **Por: R$ ${precoAtual}**`;
            if (item.old_price > item.price) {
                blocoPreco = `❌ De:  R$ ${precoAntigo}\n\n✅ **Por: R$ ${precoAtual}**`;
            }
            
            const legenda = 
                ` **${item.item_name || 'Produto Especial'}**\n\n` +
                `${blocoPreco}\n\n` +
                `⭐ Avaliação: ${item.item_rating.toFixed(1)} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n`;

            // Envia se houver imagem para evitar crash no Telegram
            if (item.image_url) {
                try {
                    await enviarTelegramComFoto(item.image_url, legenda, linkCurto);
                    console.log(`[Telegram] Postado: ${item.item_name?.substring(0, 20)}...`);
                } catch (telegramErr) {
                    console.error("[Telegram] Erro ao postar este item:", telegramErr.message);
                }
            }
            
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
    
    // Lista de termos para rotacionar os nichos do canal de achadinhos
    const temas = [
        "eletronicos", "relogio inteligente", "fone bluetooth", "casa e cozinha", 
        "organizador", "acessorios celular", "setup gamer", "achadinhos",
        "tecnologia", "moda", "kit camisa", "ferramentas", "tênis esportivo", "seleção",
        "kit upgrade", "acessorios", "objetos", "pet", "peças"
    ];   
    const termoSorteado = temas[Math.floor(Math.random() * temas.length)];
    console.log(`[Shopee] Buscando ofertas para a palavra-chave: "${termoSorteado}"`);

    // FORMATO CORRETO: Injetamos a keyword direto na string e mantemos variables como null.
    // page: 0 garante que estamos na primeira página correta do índice da Shopee.
    // limit: 40 traz volume suficiente para o random() funcionar perfeitamente sem repetir posts.
    const queryObj = {
        query: `query{productOfferV2(keyword:\"${termoSorteado}\",listType:0,sortType:2,page:0,limit:40){nodes{productName,productLink,price,priceMax,imageUrl,commissionRate}}}`,
        variables: null,
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

        const nodes = res.data?.data?.productOfferV2?.nodes || [];
        return nodes.map(n => ({
            item_name: n.productName,
            item_url: n.productLink,
            price: parseFloat(n.price),
            old_price: parseFloat(n.priceMax || n.price),
            image_url: n.imageUrl,
            item_rating: 5 
        }));

    } catch (error) {
        console.error("Erro na API da Shopee:", error.response?.data || error.message);
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

// Exportação obrigatória para o agendamento da Netlify
module.exports.handler = schedule("0 * * * *", mineradorHandler);                                                    
