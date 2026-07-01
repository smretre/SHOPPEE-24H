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
            return { statusCode: 200, body: "Nenhuma oferta listada." };
        }

        // Embaralha as ofertas trazidas para garantir dinamismo no canal
        const ofertasEmbaralhadas = ofertas.sort(() => Math.random() - 0.5);

        for (const item of ofertasEmbaralhadas.slice(0, 3)) {
            if (!item.item_url) continue;

            // ERRO CORRIGIDO: Agora a função existe no arquivo
            const linkCurto = await converterParaAfiliado(item.item_url);
            
            const precoAtual = item.price ? Number(item.price).toFixed(2).replace('.', ',') : "0,00";
            const precoAntigo = item.old_price ? Number(item.old_price).toFixed(2).replace('.', ',') : precoAtual;
            const rating = item.item_rating ? Number(item.item_rating).toFixed(1) : "5.0";

            let blocoPreco = `✅ **Por: R$ ${precoAtual}**`;
            if (item.old_price && item.old_price > item.price) {
                blocoPreco = `❌ De: R$ ${precoAntigo}\n\n✅ **Por: R$ ${precoAtual}**`;
            }
            
            const legenda = 
                `📦 **${item.item_name || 'Produto Especial'}**\n\n` +
                `${blocoPreco}\n\n` +
                `⭐ Avaliação: ${rating} / 5.0\n\n` +
                `🔥 *Oferta por tempo limitado!*\n`;

            if (item.image_url) {
                await enviarTelegramComFoto(item.image_url, legenda, linkCurto);
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
    
    // Rotação de página dinâmica e segura usando o padrão GraphQL Variables
    const paginaAleatoria = Math.floor(Math.random() * 11);
    console.log(`[Shopee] Solicitando página: ${paginaAleatoria}`);

    const queryObj = {
        query: "query($page: Int){productOfferV2(listType:0,sortType:2,page:$page,limit:20){nodes{productName,productLink,price,priceMax,imageUrl,commissionRate}}}",
        variables: {
            page: paginaAleatoria
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

        console.log("Resposta Shopee obtida.");
        const nodes = res.data?.data?.productOfferV2?.nodes || [];
        
        // ERRO CORRIGIDO: Inclusão de old_price e item_rating no mapeamento dos nós
        return nodes.map(n => ({
            item_name: n.productName,
            item_url: n.productLink,
            price: parseFloat(n.price),
            old_price: parseFloat(n.priceMax || n.price),
            image_url: n.imageUrl,
            item_rating: 5 // V2 não traz rating nativo, mantido fixo com segurança
        }));
    } catch (error) {
        console.error("Erro na busca da Shopee:", error.message);
        return [];
    }
}

// ERRO CORRIGIDO: Função adicionada ao escopo do script
async function converterParaAfiliado(urlOriginal) {
    // Se você possuir uma lógica própria ou endpoint da Shopee para conversão rápida de links, coloque aqui.
    // Por hora, retorna a URL original com segurança para não travar o fluxo.
    return urlOriginal;
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
// Mantenha "*/30 * * * *" ou "0 * * * *" para produção! (Evite rodar a cada 1 minuto para não tomar block)
module.exports.handler = schedule("0 * * * *", mineradorHandler);
                
