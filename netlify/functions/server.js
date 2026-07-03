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
        // Se o servidor estiver em UTC, subtraímos 3 horas.
        const horaBrasilia = agora.getUTCHours() - 3;
        const horaReal = horaBrasilia < 0 ? horaBrasilia + 24 : horaBrasilia;

        console.log(`Verificando horário: ${horaReal}h`);

        // Para entre 23h e 06:59h
        if (horaReal >= 23 || horaReal < 0) {
            console.log("Horário de silêncio. Encerrando para economizar requisições.");
            return { statusCode: 200, body: "Robô em modo de descanso." };
        }
        console.log("Iniciando mineração com imagens...");

        const ofertas = await buscarOfertasEmAlta();
        
        if (!ofertas || ofertas.length === 0) {
            console.log("Nenhuma oferta encontrada no momento.");
            return { statusCode: 200 };
        }

        for (const item of ofertas.slice(0, 3)) {
            const linkCurto = await converterParaAfiliado(item.item_url);
            const precoFormatado = Number(item.price).toFixed(2).replace('.', ',');
            const precoAtual = Number(item.price).toFixed(2).replace('.', ',');
            const precoAntigo = Number(item.old_price).toFixed(2).replace('.', ',');
            let blocoPreco = `✅ **Por: R$ ${precoAtual}**`;
            if (item.old_price > item.price) {
                blocoPreco = `❌ De:  R$ ${precoAntigo}\n\n✅ **Por: R$ ${precoAtual}**`;}
            
            const legenda = 
                ` **${item.item_name}**\n\n` +
                `${blocoPreco}\n\n` +
                `⭐ Avaliação: ${item.item_rating.toFixed(1)} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n`;

            await enviarTelegramComFoto(item.image_url, legenda,linkCurto);
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
    
    // Lista de termos fixos (adicione ou remova os que preferir)
    const temas = [
        "eletronicos", 
        "relogio inteligente", 
        "fone bluetooth", 
        "casa e cozinha", 
        "organizador", 
        "acessorios celular", 
        "setup gamer", 
        "achadinhos",
        "tecnologia",
        "moda",
        "camisa",
        "seleção",
        "kit upgrade",
        "ferramentas"
    ];   
    const termoSorteado = temas[Math.floor(Math.random() * temas.length)];
    console.log(`[Shopee] Buscando com segurança via variáveis para: "${termoSorteado}"`);

    // CORREÇÃO CRÍTICA: Definimos a query fixa e usamos a variável ($keyword: String) do GraphQL
    const queryObj = {
        query: "query($keyword: String){productOffer(keyword:$keyword,page:1,limit:20){nodes{productName,productLink,price,priceMax,imageUrl}}}",
        variables: {
            keyword: termoSorteado // O termo vai aqui dentro de forma limpa, sem quebrar a assinatura
        },
        operationName: null
    };
    
    // Agora o JSON fica perfeito e padronizado para gerar o Hash SHA256 idêntico ao da Shopee
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

        console.log("Resposta Shopee (Acessada):", JSON.stringify(res.data));
        
        const nodes = res.data?.data?.productOffer?.nodes || [];
        
        if (nodes.length === 0) {
            console.log(`A API aceitou, mas retornou 0 produtos para: "${termoSorteado}"`);
        }

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
async function enviarTelegramComFoto(urlImagem, legenda,linkCurto) {
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
                text: "🔥COMPRAR AGORA",
                url: linkCurto
              }
            ]
          ]
        }
    });
  }

// Exportação obrigatória para o agendamento da Netlify
module.exports.handler = schedule("* * * * *", mineradorHandler);
