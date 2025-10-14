const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const SERVER_URL = 'http://localhost:3000';
const ADMIN_NUMBER = '551198279738@c.us'; // Exemplo: '5511999999999@c.us'

const userState = new Map();
const pendingPayments = new Map();
let carrinhos = {};

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: "sessions" }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

console.log("Iniciando o Bot de Vendas...");

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('✅ Bot de Vendas online e pronto!');
    // Inicia a tarefa agendada quando o bot está pronto
    iniciarNotificadorVencimento();
});

// FUNÇÃO PARA VERIFICAR EXPIRAÇÕES
async function verificarExpiracoes() {
    console.log(`[${new Date().toLocaleString('pt-BR')}] Executando verificação de vencimentos...`);

    try {
        const { data: config } = await axios.get(`${SERVER_URL}/api/configuracoes`);

        if (config.notificador_ativo !== 'ATIVO') {
            console.log("-> Notificador está inativo. Pulando verificação.");
            return;
        }

        const diasAntes = config.notificador_dias_antecedencia || 3;
        const { data: contas } = await axios.get(`${SERVER_URL}/api/contas_expirando/${diasAntes}`);

        if (contas.length === 0) {
            console.log("-> Nenhuma conta expirando no período configurado. Verificação concluída.");
            return;
        }

        console.log(`-> Encontradas ${contas.length} contas para notificar.`);

        for (const conta of contas) {
            let mensagem = config.notificador_mensagem;
            const dataVencimento = new Date(conta.data_vencimento).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

            mensagem = mensagem.replace(/{{servico}}/g, conta.nome_servico);
            mensagem = mensagem.replace(/{{data_vencimento}}/g, dataVencimento);

            await client.sendMessage(conta.comprador_chat_id, mensagem);
            console.log(`   - Notificação enviada para ${conta.comprador_chat_id} sobre ${conta.nome_servico}`);
            
            // Marca a notificação como enviada
            await axios.post(`${SERVER_URL}/api/marcar_notificacao_enviada`, { id: conta.id });
            
            // Pausa de 2 segundos para evitar bloqueio do WhatsApp
            await new Promise(resolve => setTimeout(resolve, 2000)); 
        }
        console.log("-> Verificação de vencimentos finalizada com sucesso.");

    } catch (error) {
        console.error("❌ Erro durante a verificação de vencimentos:", error.response ? error.response.data : error.message);
    }
}

// FUNÇÃO PARA INICIAR O AGENDADOR
function iniciarNotificadorVencimento() {
    // Roda todo dia às 09:00 da manhã
    cron.schedule('0 9 * * *', verificarExpiracoes, {
        scheduled: true,
        timezone: "America/Sao_Paulo"
    });
    console.log("⏰ Notificador de vencimentos agendado para rodar todo dia às 09:00.");
}


async function enviarMenu(chatId, servicos) {
    if (!servicos || servicos.length === 0) {
        return client.sendMessage(chatId, '📦 Desculpe, não temos nenhum serviço com contas disponíveis no momento.');
    }
    let menuText = "🛒 *Nossos Serviços Disponíveis*\n\n";
    userState.set(chatId + '_servicos', servicos);
    servicos.forEach((s, index) => {
        menuText += `*${index + 1}* - ${s.nome_servico} (Em estoque: ${s.em_estoque})\n*Preço:* R$ ${s.preco.toFixed(2)}\n\n`;
    });
    menuText += "👉 *Digite o número* do serviço que você deseja comprar.\n\n💸 Para adicionar saldo, digite *pix [valor]*.\n🎟️ Para resgatar um vale-presente, digite *resgatar [código]*.";
    await client.sendMessage(chatId, menuText);
    userState.set(chatId, 'aguardando_servico');
}

async function enviarBoasVindas(message, config) {
    const contact = await message.getContact();
    const chatId = message.from;
    const nomeUsuario = contact.pushname || contact.name || "Cliente";
    const idUsuario = chatId.replace('@c.us', '');
    const { data: usuario } = await axios.get(`${SERVER_URL}/api/usuario/${chatId}`);
    const { data: compras } = await axios.get(`${SERVER_URL}/api/usuario/${chatId}/contagem_compras`);
    const saldo = usuario.saldo || 0;
    const contagemCompras = compras.contagem || 0;
    let welcomeTemplate = config.template_boas_vindas || "Bem-vindo à {{nome_loja}}!";
    let userDataTemplate = config.template_dados_usuario || "Seus dados.";
    const replacements = { '{{nome_loja}}': config.nome_loja, '{{nome}}': nomeUsuario, '{{usuario}}': nomeUsuario, '{{id}}': idUsuario, '{{saldo}}': saldo.toFixed(2), '{{compras}}': contagemCompras };
    for (const key in replacements) {
        welcomeTemplate = welcomeTemplate.replace(new RegExp(key, 'g'), replacements[key]);
        userDataTemplate = userDataTemplate.replace(new RegExp(key, 'g'), replacements[key]);
    }
    await client.sendMessage(chatId, welcomeTemplate);
    await client.sendMessage(chatId, userDataTemplate);
}

function formatarMensagemSucesso(conta) {
    const { login, senha, nome, duracao, descricao } = conta;
    let msgSucesso = `\n✅ Pagamento confirmado!\n\nSua conta *${nome}* foi entregue com sucesso!\n\nLogin: \`${login}\`\nSenha: \`${senha}\`\n`;
    if (descricao && descricao.trim() !== '') {
        msgSucesso += `\nDescrição: *${descricao}*`;
    }
    msgSucesso += `\nDuração: *${duracao} dias*\n\nQualquer problema, contate o suporte:\n*11 98279-7383*`;
    return msgSucesso.trim();
}

client.on('message', async (message) => {
    const chatId = message.from;
    const texto = message.body.trim();
    const lowerCaseText = texto.toLowerCase();

    let config;
    try {
        const { data } = await axios.get(`${SERVER_URL}/api/configuracoes`);
        config = data;
    } catch (e) {
        console.error("Não foi possível buscar as configurações:", e.message);
        return message.reply("😥 Desculpe, estou com um problema de comunicação com o servidor principal.");
    }
    
    if (config.modo_manutencao === 'ATIVO' && chatId !== ADMIN_NUMBER) {
        return message.reply("🛠️ Olá! No momento, nosso sistema está em manutenção para trazer novidades. Por favor, volte mais tarde!");
    }

    console.log(`--- MENSAGEM RECEBIDA DE: ${chatId} | TEXTO: "${texto}" ---`);
    
    if (lowerCaseText === 'menu' || lowerCaseText === 'oi') {
        await enviarBoasVindas(message, config);
        const { data: apiData } = await axios.get(`${SERVER_URL}/api/produtos`);
        await enviarMenu(chatId, apiData.servicos);
        return;
    }
    
    if (lowerCaseText.startsWith('resgatar')) {
        const code = texto.split(' ')[1];
        if (!code) { return message.reply("Por favor, informe o código do Gift Card. Exemplo: `resgatar MEUCODIGO`"); }
        try {
            await message.reply("⏳ Validando seu código...");
            const { data } = await axios.post(`${SERVER_URL}/api/resgatar-gift`, { chatId, code });
            if (data.status === 'sucesso') {
                const successMessage = `🎉🎊🎁*gift resgatado com sucesso R$ ${data.valor_resgatado.toFixed(2)}*🎁🎊🎉`;
                try {
                    const imageUrl = `${SERVER_URL}/uploads/${config.imagem_resgate}`;
                    const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                    await client.sendMessage(chatId, media, { caption: successMessage });
                } catch (imgError) {
                    console.error("Erro ao carregar imagem de resgate pela URL. Enviando apenas texto.", imgError.message);
                    await client.sendMessage(chatId, successMessage);
                }
            }
        } catch (error) {
            console.error("\n--- ERRO DETALHADO AO RESGATAR GIFT ---");
            if (error.response) { console.error("Status:", error.response.status); console.error("Dados:", error.response.data); } 
            else if (error.request) { console.error("Nenhuma resposta recebida. O server.js está rodando?"); console.error(error.message); } 
            else { console.error("Erro no Axios:", error.message); }
            console.error("--- FIM DO ERRO ---\n");
            const errorMessage = error.response?.data?.error || "Ocorreu um erro desconhecido.";
            message.reply(`❌ ${errorMessage}`);
        }
        userState.delete(chatId);
        return;
    }

    if (lowerCaseText.startsWith('pix ')) {
        const partes = texto.split(' ');
        const valorStr = partes[1] ? partes[1].replace(',', '.') : '';
        const valor = parseFloat(valorStr);
        if (isNaN(valor) || valor <= 0) return message.reply("❌ Valor inválido. Use o formato *pix 10*.");
        try {
            const { data } = await axios.post(`${SERVER_URL}/api/criar_pagamento`, { chatId, preco: valor, tipo: 'saldo' });
            pendingPayments.set(chatId, { id: data.paymentId, tipo: 'saldo' });
            const infoMessage = `💰 Pagamento para adicionar saldo:\n\n⏱ Expira em: ${data.expiraEm} minutos\n💰 Valor: R$${data.valor.toFixed(2)}\n\n✨ Após realizar o pagamento, envie a palavra \`confirmar\` para creditar seu saldo!\n\n💎 Pix copia e cola:`.trim();
            await client.sendMessage(chatId, infoMessage);
            await client.sendMessage(chatId, data.pixCopiaECola);
        } catch (error) { message.reply("😥 Tivemos um problema ao gerar seu PIX."); }
        userState.delete(chatId);
        return;
    }

    const switchCommands = ['finalizar', 'confirmar'];
    if (switchCommands.includes(lowerCaseText)) {
        userState.delete(chatId);
        switch (lowerCaseText) {
            case 'finalizar':
                const itemParaPagar = carrinhos[chatId];
                if (!itemParaPagar) return message.reply('🛒 Você não selecionou um serviço. Digite *menu* para escolher.');
                try {
                    const { data: usuario } = await axios.get(`${SERVER_URL}/api/usuario/${chatId}`);
                    if (usuario.saldo >= itemParaPagar.preco) {
                        await message.reply("💸 Detectei saldo suficiente! Processando sua compra...");
                        const { data: resultadoCompra } = await axios.post(`${SERVER_URL}/api/comprar_com_saldo`, { chatId: chatId, servico: itemParaPagar });
                        if (resultadoCompra.status === 'sucesso') {
                            const msgSucesso = formatarMensagemSucesso(resultadoCompra.conta);
                            await client.sendMessage(chatId, msgSucesso);
                            delete carrinhos[chatId];
                        }
                    } else {
                        await message.reply(`😕 Seu saldo de R$ ${usuario.saldo.toFixed(2)} é insuficiente. Gerando um PIX para o pagamento do produto (R$ ${itemParaPagar.preco.toFixed(2)})...`);
                        const { data } = await axios.post(`${SERVER_URL}/api/criar_pagamento`, { chatId: chatId, preco: itemParaPagar.preco, nomeProduto: itemParaPagar.nome_servico, tipo: 'produto' });
                        pendingPayments.set(chatId, { id: data.paymentId, tipo: 'produto' });
                        const infoMessage = `💰 Pagamento via PIX Automático:\n\n⏱ Expira em: ${data.expiraEm} minutos\n💰 Valor: R$${data.valor.toFixed(2)}\n\n✨ Após realizar o pagamento, envie a palavra \`confirmar\` para receber seu produto!\n\n💎 Pix copia e cola:`.trim();
                        await client.sendMessage(chatId, infoMessage);
                        await client.sendMessage(chatId, data.pixCopiaECola);
                        delete carrinhos[chatId];
                    }
                } catch (error) {
                    console.error("Erro ao finalizar compra:", error.response ? error.response.data : error.message);
                    message.reply("😥 Tivemos um problema ao finalizar sua compra.");
                }
                return;
            case 'confirmar':
                const paymentInfo = pendingPayments.get(chatId);
                if (!paymentInfo) return message.reply("Você não tem um pagamento pendente.");
                await message.reply("⏳ Verificando seu pagamento...");
                try {
                    const { data } = await axios.get(`${SERVER_URL}/api/verificar_pagamento/${paymentInfo.id}`);
                    if (data.status === 'aprovado') {
                        if (data.tipo === 'saldo') {
                            const { data: usuario } = await axios.get(`${SERVER_URL}/api/usuario/${chatId}`);
                            await client.sendMessage(chatId, `✅ Pagamento confirmado! Seu novo saldo é de *R$ ${usuario.saldo.toFixed(2)}*.`);
                        } else {
                            const msgSucesso = formatarMensagemSucesso(data.conta);
                            await client.sendMessage(chatId, msgSucesso);
                        }
                        pendingPayments.delete(chatId);
                    } else {
                        await message.reply("😕 Pagamento ainda não foi aprovado.");
                    }
                } catch (error) { await message.reply("😥 Ocorreu um erro ao verificar seu pagamento."); }
                return;
        }
    }
    
    if (userState.get(chatId) === 'aguardando_servico') {
        const servicosDisponiveis = userState.get(chatId + '_servicos');
        const escolhaIndex = parseInt(texto) - 1;
        if (servicosDisponiveis && !isNaN(escolhaIndex) && escolhaIndex >= 0 && escolhaIndex < servicosDisponiveis.length) {
            const servicoEscolhido = servicosDisponiveis[escolhaIndex];
            carrinhos[chatId] = servicoEscolhido;
            await message.reply(`✅ *${servicoEscolhido.nome_servico}* selecionado por *R$ ${servicoEscolhido.preco.toFixed(2)}*.\n\nDigite *finalizar* para comprar.`);
        } else {
            await message.reply("❌ Opção inválida. Por favor, digite o número de um dos serviços listados acima, ou um comando como `menu`.");
        }
        userState.delete(chatId);
        return;
    }
});

client.initialize();