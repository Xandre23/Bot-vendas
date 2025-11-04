const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { exec } = require('child_process');
const Convert = require('ansi-to-html');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');

const SERVER_URL = 'https://bot-vendas-production-a993.up.railway.app';

const app = express();
const port = process.env.PORT || 3000;
const convert = new Convert();

let mpClient;
let mpPayment;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const fileName = 'resgate-custom' + path.extname(file.originalname);
        cb(null, fileName);
    }
});
const upload = multer({ storage: storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//codigo certo comentado
//const db = new sqlite3.Database('./database.db', (err) => {
const db = new sqlite3.Database('/tmp/database.db', (err) => {
    if (err) {
        console.error("Erro fatal ao abrir o banco de dados", err.message);
        return;
    }
    console.log("Conectado ao banco de dados SQLite.");

    const initializeApp = async () => {
        await dbRun(`CREATE TABLE IF NOT EXISTS contas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome_servico TEXT NOT NULL, email TEXT NOT NULL, senha TEXT NOT NULL, preco REAL NOT NULL, duracao_dias INTEGER, descricao TEXT, status TEXT DEFAULT 'disponivel', comprador_chat_id TEXT, vendida_em DATETIME, notificacao_vencimento_enviada BOOLEAN DEFAULT 0)`);
        await dbRun(`CREATE TABLE IF NOT EXISTS usuarios (chat_id TEXT PRIMARY KEY, nome TEXT, saldo REAL DEFAULT 0)`);
        await dbRun(`CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
        await dbRun(`CREATE TABLE IF NOT EXISTS gift_cards (code TEXT PRIMARY KEY, value REAL NOT NULL, status TEXT DEFAULT 'disponivel', redeemed_by_chat_id TEXT, redeemed_at TEXT)`);
        
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('modo_manutencao', 'INATIVO')`);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('nome_loja', 'UPZÃO STORE')`);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('imagem_resgate', 'resgate.jpg')`);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('mp_access_token', '')`);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('notificador_ativo', 'INATIVO')`);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('notificador_dias_antecedencia', '3')`);
        const templateNotificacao = `👋 Olá! Sua assinatura do serviço *{{servico}}* está prestes a vencer, no dia *{{data_vencimento}}*.\n\nPara renovar e continuar aproveitando, digite *menu* e escolha o serviço novamente!`;
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('notificador_mensagem', ?)`, [templateNotificacao]);

        const templateBoasVindas = `⚙️𝐒𝐄𝐉𝐀 𝐓𝐎𝐃𝐎s 𝐁𝐄𝐌 𝐕𝐈𝐍𝐃𝐎 𝐀 {{nome_loja}}!🚬 \n\n🤖 Comprando no meu bot, você garante o melhor login do mercado com *entrega automática e instantânea*!\n\n💸 *COMO FUNCIONA? É MUITO SIMPLES!*`;
        const templateDadosUsuario = `📌𝐒𝐄𝐔𝐒 𝐃𝐀𝐃𝐎𝐒 𝐀𝐁𝐀𝐈𝐗𝐎:\n├👤 𝗡𝗼𝗺𝗲: {{nome}}\n├👤 𝗨𝘀𝘂𝗮‌𝗿𝗶ɔ: {{usuario}}\n├🆔 NUMERO: {{id}}\n├ 💸 𝗦𝗮𝗹𝗱𝗼: 𝙍$ {{saldo}}\n├ 🛍️ 𝗟𝗼𝗴𝗶𝗻𝘀 𝗰𝗼𝗺𝗽𝗿𝗮𝗱𝗼𝘀: {{compras}}\n└ 🤳🏻 𝗣𝗼𝗻𝘁𝗼𝘀 𝗱𝗲 𝗜𝗻𝗱𝗶𝗰𝗮𝗰‌𝗮‌𝗼: 0`;
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('template_boas_vindas', ?)`, [templateBoasVindas.trim()]);
        await dbRun(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('template_dados_usuario', ?)`, [templateDadosUsuario.trim()]);

        const tokenRow = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
        const MERCADOPAGO_ACCESS_TOKEN = tokenRow ? tokenRow.valor : '';

        if (MERCADOPAGO_ACCESS_TOKEN && MERCADOPAGO_ACCESS_TOKEN.length > 10) {
            try {
                mpClient = new MercadoPagoConfig({ accessToken: MERCADOPAGO_ACCESS_TOKEN, options: { timeout: 5000 } });
                mpPayment = new Payment(mpClient);
                console.log("✅ Cliente Mercado Pago inicializado com token do banco de dados.");
            } catch (e) {
                console.error("❌ Token do Mercado Pago inválido. Verifique o token no painel.", e.message);
            }
        } else {
            console.warn("⚠️ ATENÇÃO: Token do Mercado Pago não configurado no painel. A geração de PIX não funcionará.");
        }

        app.listen(port, () => {
            console.log(`Painel admin rodando em http://localhost:${port}/admin`);
        });
    };

    initializeApp().catch(err => {
        console.error("Erro ao inicializar o aplicativo:", err);
    });
});

const dbAll = (query, params = []) => new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbGet = (query, params = []) => new Promise((resolve, reject) => db.get(query, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (query, params = []) => new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this); }));

// --- API Endpoints ---
app.get('/api/contas_expirando/:dias', async (req, res) => {
    const dias = req.params.dias;
    try {
        const query = `
            SELECT id, comprador_chat_id, nome_servico, DATE(vendida_em, '+' || duracao_dias || ' days') as data_vencimento
            FROM contas
            WHERE status = 'vendida'
              AND notificacao_vencimento_enviada = 0
              AND DATE(vendida_em, '+' || duracao_dias || ' days') = DATE('now', 'localtime', '+${dias} days')
        `;
        const contas = await dbAll(query);
        res.json(contas);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/marcar_notificacao_enviada', async (req, res) => {
    const { id } = req.body;
    try {
        await dbRun("UPDATE contas SET notificacao_vencimento_enviada = 1 WHERE id = ?", [id]);
        res.json({ status: 'sucesso' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/criar_pagamento', async (req, res) => {
    if (!mpPayment) { return res.status(500).json({ error: "O token do Mercado Pago não está configurado no servidor. Contate o administrador." }); }
    const { chatId, preco, nomeProduto, tipo } = req.body;
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 15);
    const payment_data = { transaction_amount: Number(preco), description: tipo === 'saldo' ? `Adicionar Saldo R$${preco}` : `Compra de ${nomeProduto}`, payment_method_id: 'pix', payer: { email: 'cliente@email.com' }, date_of_expiration: expirationDate.toISOString(), external_reference: JSON.stringify({ chatId, nomeProduto, tipo, valor: preco }) };
    try {
        const result = await mpPayment.create({ body: payment_data });
        res.json({ paymentId: result.id, pixCopiaECola: result.point_of_interaction.transaction_data.qr_code, valor: preco, expiraEm: 15 });
    } catch (error) {
        console.error("Erro do Mercado Pago ao criar PIX:", error);
        res.status(500).json({ error: "Falha ao gerar PIX" });
    }
});
app.get('/api/verificar_pagamento/:paymentId', async (req, res) => {
    if (!mpPayment) { return res.status(500).json({ error: "O token do Mercado Pago não está configurado no servidor." }); }
    try {
        const paymentInfo = await mpPayment.get({ id: req.params.paymentId });
        if (paymentInfo.status === 'approved') {
            const ref = JSON.parse(paymentInfo.external_reference);
            const { chatId, nomeProduto, tipo, valor } = ref;
            if (tipo === 'saldo') {
                await dbRun('UPDATE usuarios SET saldo = saldo + ? WHERE chat_id = ?', [valor, chatId]);
                res.json({ status: 'aprovado', tipo: 'saldo' });
            } else {
                const conta = await dbGet("SELECT * FROM contas WHERE nome_servico = ? AND status = 'disponivel' LIMIT 1", [nomeProduto]);
                if (!conta) return res.status(500).json({ error: "Sem estoque no momento da confirmação." });
                await dbRun("UPDATE contas SET status = 'vendida', comprador_chat_id = ?, vendida_em = DATETIME('now', 'localtime') WHERE id = ?", [chatId, conta.id]);
                res.json({ status: 'aprovado', tipo: 'produto', conta: { login: conta.email, senha: conta.senha, nome: conta.nome_servico, duracao: conta.duracao_dias, descricao: conta.descricao } });
            }
        } else {
            res.json({ status: paymentInfo.status });
        }
    } catch (error) {
        console.error("Erro do Mercado Pago ao verificar pagamento:", error);
        res.status(500).json({ error: "Falha ao verificar pagamento." });
    }
});
app.post('/api/resgatar-gift', async (req, res) => {
    const { chatId, code } = req.body;
    try {
        const giftCard = await dbGet('SELECT * FROM gift_cards WHERE code = ?', [code.toUpperCase()]);
        if (!giftCard || giftCard.status !== 'disponivel') {
            return res.status(404).json({ error: 'Gift Card inválido, expirado ou já utilizado.' });
        }
        await dbRun('BEGIN TRANSACTION');
        await dbRun('UPDATE usuarios SET saldo = saldo + ? WHERE chat_id = ?', [giftCard.value, chatId]);
        await dbRun("UPDATE gift_cards SET status = 'resgatado', redeemed_by_chat_id = ?, redeemed_at = DATETIME('now', 'localtime') WHERE code = ?", [chatId, code.toUpperCase()]);
        await dbRun('COMMIT');
        console.log(`Gift Card ${code} de R$${giftCard.value} resgatado por ${chatId}`);
        res.json({ status: 'sucesso', valor_resgatado: giftCard.value });
    } catch (error) {
        await dbRun('ROLLBACK');
        console.error("Erro ao resgatar gift card:", error);
        res.status(500).json({ error: 'Ocorreu um erro no servidor ao tentar resgatar o código.' });
    }
});
app.post('/api/comprar_com_saldo', async (req, res) => {
    const { chatId, servico } = req.body;
    try {
        const usuario = await dbGet('SELECT * FROM usuarios WHERE chat_id = ?', [chatId]);
        if (!usuario) return res.status(500).json({ error: "Usuário não encontrado." });
        if (usuario.saldo >= servico.preco) {
            const conta = await dbGet("SELECT * FROM contas WHERE nome_servico = ? AND status = 'disponivel' LIMIT 1", [servico.nome_servico]);
            if (!conta) return res.status(400).json({ error: "Produto esgotado." });
            await dbRun("BEGIN TRANSACTION");
            await dbRun('UPDATE usuarios SET saldo = saldo - ? WHERE chat_id = ?', [servico.preco, chatId]);
            await dbRun("UPDATE contas SET status = 'vendida', comprador_chat_id = ?, vendida_em = DATETIME('now', 'localtime') WHERE id = ?", [chatId, conta.id]);
            await dbRun("COMMIT");
            res.json({ status: 'sucesso', conta: { login: conta.email, senha: conta.senha, nome: conta.nome_servico, duracao: conta.duracao_dias, descricao: conta.descricao } });
        } else {
            res.status(400).json({ error: 'saldo_insuficiente', saldo_atual: usuario.saldo });
        }
    } catch (err) {
        await dbRun("ROLLBACK");
        res.status(500).json({ error: "Erro no servidor." });
    }
});
app.get('/api/configuracoes', async (req, res) => { try { const rows = await dbAll("SELECT chave, valor FROM configuracoes"); const configs = rows.reduce((acc, row) => ({...acc, [row.chave]: row.valor }), {}); res.json(configs); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/produtos', async (req, res) => { try { const rows = await dbAll("SELECT nome_servico, MIN(preco) as preco, COUNT(*) as em_estoque FROM contas WHERE status = 'disponivel' GROUP BY nome_servico"); res.json({ servicos: rows }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/usuario/:chatId', async (req, res) => { const { chatId } = req.params; try { let row = await dbGet('SELECT * FROM usuarios WHERE chat_id = ?', [chatId]); if (row) { res.json(row); } else { await dbRun('INSERT INTO usuarios (chat_id, saldo) VALUES (?, ?)', [chatId, 0]); res.json({ chat_id: chatId, nome: null, saldo: 0 }); } } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/usuario/:chatId/contagem_compras', async (req, res) => { const { chatId } = req.params; try { const row = await dbGet("SELECT COUNT(*) as total FROM contas WHERE comprador_chat_id = ?", [chatId]); res.json({ contagem: row ? row.total : 0 }); } catch (err) { res.status(500).json({ error: err.message }); } });

// --- Painel Admin ---
app.get('/admin/ligar-bot', (req, res) => exec('pm2 start upzao-bot', () => res.redirect('/admin')));
app.get('/admin/desligar-bot', (req, res) => exec('pm2 stop upzao-bot', () => res.redirect('/admin')));
app.get('/admin/reiniciar-bot', (req, res) => exec('pm2 restart upzao-bot', () => res.redirect('/admin')));
app.get('/admin/manutencao/ativar', (req, res) => dbRun("UPDATE configuracoes SET valor = 'ATIVO' WHERE chave = 'modo_manutencao'").then(() => res.redirect('/admin')));
app.get('/admin/manutencao/desativar', (req, res) => dbRun("UPDATE configuracoes SET valor = 'INATIVO' WHERE chave = 'modo_manutencao'").then(() => res.redirect('/admin')));
app.get('/admin/desconectar', (req, res) => { exec('pm2 stop upzao-bot', () => { const sessionPath = path.join(__dirname, 'sessions'); fs.rm(sessionPath, { recursive: true, force: true }, () => res.redirect('/admin')); }); });
app.get('/admin/logs', (req, res) => { exec('pm2 logs upzao-bot --lines 100 --nostream', (error, stdout, stderr) => { const logs = (error || stderr) ? `Erro ao carregar logs: ${error || stderr}` : stdout; const htmlLogs = new Convert().toHtml(logs); let html = `<!DOCTYPE html><html lang="pt-BR" data-bs-theme="dark"><head><meta charset="UTF-8"><title>Logs do Bot</title><meta http-equiv="refresh" content="5"><style>body{background-color:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:20px}pre{white-space:pre-wrap;word-wrap:break-word}.log-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #555;padding-bottom:10px}h1{color:#569cd6}a{color:#ce9178;padding:10px;border:1px solid #ce9178;border-radius:5px;text-decoration:none}</style></head><body><div class="log-header"><h1>Logs do Bot / QR Code</h1><a href="/admin/logs">Atualizar Logs</a></div><pre>${htmlLogs}</pre></body></html>`; res.send(html); }); });
app.post('/admin/salvar-config', async (req, res) => { const { nome_loja, template_boas_vindas, template_dados_usuario, mp_access_token, notificador_ativo, notificador_dias_antecedencia, notificador_mensagem } = req.body; try { await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'nome_loja'", [nome_loja]); await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'template_boas_vindas'", [template_boas_vindas]); await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'template_dados_usuario'", [template_dados_usuario]); if (mp_access_token) { await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'mp_access_token'", [mp_access_token]); } await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'notificador_ativo'", [notificador_ativo || 'INATIVO']); await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'notificador_dias_antecedencia'", [notificador_dias_antecedencia]); await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'notificador_mensagem'", [notificador_mensagem]); } catch(e) { console.error("Erro ao salvar configurações:", e); } res.redirect('/admin'); });
app.post('/admin/adicionar', (req, res) => { const { nome_servico, email, senha, preco, duracao_dias, descricao } = req.body; dbRun(`INSERT INTO contas (nome_servico, email, senha, preco, duracao_dias, descricao) VALUES (?, ?, ?, ?, ?, ?)`, [nome_servico, email, senha, preco, duracao_dias, descricao]).then(() => res.redirect('/admin')); });
app.post('/admin/remover', (req, res) => { dbRun(`DELETE FROM contas WHERE id = ?`, req.body.id).then(() => res.redirect('/admin')); });
app.get('/admin/editar/:id', async (req, res) => { const id = req.params.id; const conta = await dbGet("SELECT * FROM contas WHERE id = ?", [id]); if (!conta) return res.status(404).send("Conta não encontrada."); let html = `<!DOCTYPE html><html lang="pt-BR" id="html-tag"><head><meta charset="UTF-8"><title>Editar Conta</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"></head><body><div class="container mt-5"><div class="card"><div class="card-header"><h1>Editar Conta #${conta.id}</h1></div><div class="card-body"><form action="/admin/editar/${conta.id}" method="POST"><div class="mb-3"><label class="form-label">Streaming:</label><input type="text" class="form-control" name="nome_servico" value="${conta.nome_servico}" required></div><div class="mb-3"><label class="form-label">Email:</label><input type="email" class="form-control" name="email" value="${conta.email}" required></div><div class="mb-3"><label class="form-label">Senha:</label><input type="text" class="form-control" name="senha" value="${conta.senha}" required></div><div class="mb-3"><label class="form-label">Descrição:</label><input type="text" class="form-control" name="descricao" value="${conta.descricao || ''}" placeholder="Ex: Tela Adulto, não alterar senha"></div><div class="mb-3"><label class="form-label">Valor (R$):</label><input type="number" step="0.01" class="form-control" name="preco" value="${conta.preco}" required></div><div class="mb-3"><label class="form-label">Duração (dias):</label><input type="number" class="form-control" name="duracao_dias" value="${conta.duracao_dias}" required></div><button type="submit" class="btn btn-primary">Salvar Alterações</button></form></div></div></div><script>const savedTheme = localStorage.getItem('theme') || 'light'; document.documentElement.setAttribute('data-bs-theme', savedTheme);</script></body></html>`; res.send(html); });
app.post('/admin/editar/:id', (req, res) => { const { id } = req.params; const { nome_servico, email, senha, preco, duracao_dias, descricao } = req.body; dbRun(`UPDATE contas SET nome_servico = ?, email = ?, senha = ?, preco = ?, duracao_dias = ?, descricao = ? WHERE id = ?`, [nome_servico, email, senha, preco, duracao_dias, descricao, id]).then(() => res.redirect('/admin')); });
app.get('/admin/adicionar-massa', (req, res) => { let html = `<!DOCTYPE html><html lang="pt-BR" id="html-tag"><head><meta charset="UTF-8"><title>Adicionar Contas em Massa</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"></head><body><div class="container mt-5"><div class="card"><div class="card-header"><h1>Adicionar Contas por Quantidade</h1></div><div class="card-body"><p>Preencha os dados que serão iguais para todas as contas e cole a lista de logins na caixa de texto.</p><form action="/admin/adicionar-massa" method="POST"><div class="row g-3"><div class="col-md-4"><label class="form-label">Streaming:</label><input type="text" class="form-control" name="nome_servico" placeholder="ex: Netflix" required></div><div class="col-md-4"><label class="form-label">Valor (R$):</label><input type="number" step="0.01" class="form-control" name="preco" placeholder="para todas" required></div><div class="col-md-4"><label class="form-label">Duração (dias):</label><input type="number" class="form-control" name="duracao_dias" placeholder="para todas" required></div><div class="col-12"><label class="form-label">Descrição:</label><input type="text" class="form-control" name="descricao" placeholder="Ex: Tela Adulto, não alterar senha"></div><div class="col-12"><label for="contas_lista" class="form-label">Lista de contas (formato: email:senha, uma por linha):</label><textarea class="form-control" name="contas_lista" id="contas_lista" rows="8" placeholder="exemplo1@email.com:senha123\nfulano@email.com:senha456" required></textarea></div><div class="col-12"><button type="submit" class="btn btn-primary">Adicionar Contas em Massa</button></div></div></form><a href="/admin" class="mt-3 d-inline-block">Voltar para o painel principal</a></div></div></div><script>const savedTheme = localStorage.getItem('theme') || 'light'; document.documentElement.setAttribute('data-bs-theme', savedTheme);</script></body></html>`; res.send(html); });
app.post('/admin/adicionar-massa', (req, res) => { const { nome_servico, preco, duracao_dias, descricao, contas_lista } = req.body; const linhas = contas_lista.split(/\r?\n/).filter(line => line.trim() !== ''); db.serialize(() => { db.run("BEGIN TRANSACTION"); const stmt = db.prepare("INSERT INTO contas (nome_servico, email, senha, preco, duracao_dias, descricao) VALUES (?, ?, ?, ?, ?, ?)"); for (const linha of linhas) { const partes = linha.split(':'); if (partes.length >= 2) { const email = partes[0].trim(); const senha = partes.slice(1).join(':').trim(); stmt.run(nome_servico, email, senha, preco, duracao_dias, descricao); } } stmt.finalize(); db.run("COMMIT", () => res.redirect('/admin')); }); });
app.post('/admin/gerar-gift', async (req, res) => { const { value, custom_code } = req.body; let finalCode; if (custom_code && custom_code.trim() !== '') { finalCode = custom_code.trim().toUpperCase().replace(/\s+/g, '-'); } else { finalCode = crypto.randomBytes(4).toString('hex').toUpperCase(); } try { await dbRun('INSERT INTO gift_cards (code, value) VALUES (?, ?)', [finalCode, value]); res.redirect('/admin'); } catch (error) { if (error.code === 'SQLITE_CONSTRAINT') { res.redirect('/admin?error=codigoduplicado'); } else { console.error("Erro ao gerar gift card:", error); res.status(500).send("Ocorreu um erro no servidor."); } } });
app.post('/admin/upload-imagem', upload.single('imagem_resgate_file'), async (req, res) => { if (req.file) { try { await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'imagem_resgate'", [req.file.filename]); console.log(`Imagem de resgate atualizada para: ${req.file.filename}`); } catch (err) { console.error("Erro ao salvar o nome da imagem no banco de dados:", err); } } res.redirect('/admin'); });
app.get('/admin/reiniciar-servidor', (req, res) => { const loadingPageHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reiniciando Servidor...</title><style>body { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f8f9fa; color: #212529; } .spinner { border: 8px solid #e9ecef; border-top: 8px solid #0d6efd; border-radius: 50%; width: 60px; height: 60px; animation: spin 1.5s linear infinite; } @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } h1 { margin-top: 20px; font-weight: 500; } p { color: #6c757d; }</style></head><body><div class="spinner"></div><h1>Servidor reiniciando...</h1><p>A página será redirecionada automaticamente assim que o serviço estiver online.</p><script>const checkServerStatus = () => { fetch('/admin', { mode: 'no-cors' }).then(response => { console.log('Servidor online! Redirecionando...'); clearInterval(intervalId); window.location.href = '/admin'; }).catch(error => { console.log('Servidor ainda offline, tentando novamente...'); }); }; const intervalId = setInterval(checkServerStatus, 2000);</script></body></html>`; res.send(loadingPageHtml); exec('pm2 restart upzao-painel', (err, stdout, stderr) => { if (err) { console.error("Erro ao reiniciar o servidor:", stderr); } console.log("Servidor reiniciado com sucesso via PM2:", stdout); }); });
app.get('/admin/exportar-vendas', async (req, res) => { try { const vendas = await dbAll("SELECT vendida_em, nome_servico, preco, comprador_chat_id, email, descricao FROM contas WHERE status = 'vendida' ORDER BY vendida_em DESC"); const workbook = new ExcelJS.Workbook(); workbook.creator = 'UpzaoBot'; workbook.created = new Date(); const worksheet = workbook.addWorksheet('Relatório de Vendas'); worksheet.columns = [ { header: 'Data da Venda', key: 'vendida_em', width: 20 }, { header: 'Produto', key: 'nome_servico', width: 25 }, { header: 'Preço (R$)', key: 'preco', width: 15, style: { numFmt: '"R$"#,##0.00' } }, { header: 'Comprador (ID do WhatsApp)', key: 'comprador_chat_id', width: 30 }, { header: 'Login (Email)', key: 'email', width: 35 }, { header: 'Descrição', key: 'descricao', width: 40 } ]; worksheet.getRow(1).font = { bold: true }; worksheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFDDDDDD'} }; worksheet.getRow(1).border = { bottom: { style:'thin' } }; vendas.forEach(venda => { const vendaFormatada = { ...venda, vendida_em: venda.vendida_em ? new Date(venda.vendida_em).toLocaleString('pt-BR') : 'N/A' }; worksheet.addRow(vendaFormatada); }); const dataFormatada = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-'); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Vendas_${dataFormatada}.xlsx"`); await workbook.xlsx.write(res); res.end(); } catch (error) { console.error("Erro ao gerar relatório Excel:", error); res.status(500).send("Ocorreu um erro ao gerar o relatório."); } });
app.get('/admin/dashboard', async (req, res) => { try { const vendasUltimos7Dias = await dbAll("SELECT strftime('%d/%m', vendida_em) as dia, COUNT(*) as total_vendas, SUM(preco) as faturamento FROM contas WHERE status = 'vendida' AND vendida_em >= date('now', '-7 days') GROUP BY dia ORDER BY vendida_em ASC"); const vendasMensais = await dbAll("SELECT strftime('%Y-%m', vendida_em) as mes, COUNT(*) as total_vendas, SUM(preco) as faturamento FROM contas WHERE status = 'vendida' AND vendida_em >= date('now', '-12 months') GROUP BY mes ORDER BY mes ASC"); const topProdutos = await dbAll("SELECT nome_servico, COUNT(*) as total_vendas FROM contas WHERE status = 'vendida' GROUP BY nome_servico ORDER BY total_vendas DESC LIMIT 5"); let html = `<!DOCTYPE html><html lang="pt-BR" id="html-tag"><head><meta charset="UTF-8"><title>Dashboard de Vendas</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"></head><body><div class="container mt-4 mb-5"><div class="d-flex justify-content-between align-items-center mb-4"><h1><i class="bi bi-graph-up"></i> Dashboard de Vendas</h1><div class="d-flex gap-2"><a href="/admin/exportar-vendas" class="btn btn-success"><i class="bi bi-file-earmark-excel"></i> Baixar Relatório (Excel)</a><a href="/admin" class="btn btn-secondary">Voltar ao Painel Principal</a></div></div><div class="row"><div class="col-lg-8"><div class="card mb-4"><div class="card-header">Vendas por Dia (Últimos 7 Dias)</div><div class="card-body"><canvas id="vendasDiariasChart"></canvas></div></div></div><div class="col-lg-4"><div class="card mb-4"><div class="card-header">Top 5 Produtos Mais Vendidos</div><div class="card-body"><canvas id="topProdutosChart"></canvas></div></div></div><div class="col-12"><div class="card mb-4"><div class="card-header">Faturamento Mensal (Últimos 12 Meses)</div><div class="card-body"><canvas id="faturamentoMensalChart"></canvas></div></div></div></div></div><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>const applyTheme=()=>{const savedTheme=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-bs-theme',savedTheme);Chart.defaults.color=savedTheme==='dark'?'#dee2e6':'#6c757d'};applyTheme();const dailyCtx=document.getElementById('vendasDiariasChart').getContext('2d');const dailyData=${JSON.stringify(vendasUltimos7Dias)};new Chart(dailyCtx,{type:'bar',data:{labels:dailyData.map(d=>d.dia),datasets:[{label:'Nº de Vendas',data:dailyData.map(d=>d.total_vendas),backgroundColor:'rgba(54, 162, 235, 0.5)',borderColor:'rgba(54, 162, 235, 1)',borderWidth:1}]},options:{scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});const monthlyCtx=document.getElementById('faturamentoMensalChart').getContext('2d');const monthlyData=${JSON.stringify(vendasMensais)};new Chart(monthlyCtx,{type:'line',data:{labels:monthlyData.map(d=>d.mes),datasets:[{label:'Faturamento (R$)',data:monthlyData.map(d=>d.faturamento),fill:false,borderColor:'rgb(75, 192, 192)',tension:0.1}]},options:{scales:{y:{beginAtZero:true}}}});const topProductsCtx=document.getElementById('topProdutosChart').getContext('2d');const topProductsData=${JSON.stringify(topProdutos)};new Chart(topProductsCtx,{type:'doughnut',data:{labels:topProductsData.map(p=>p.nome_servico),datasets:[{label:'Vendas',data:topProductsData.map(p=>p.total_vendas),backgroundColor:['rgba(255, 99, 132, 0.5)','rgba(54, 162, 235, 0.5)','rgba(255, 206, 86, 0.5)','rgba(75, 192, 192, 0.5)','rgba(153, 102, 255, 0.5)']}]}})</script></body></html>`; res.send(html); } catch (e) { console.error("Erro ao carregar o dashboard:", e); res.status(500).send("Erro ao carregar o dashboard: " + e.message); } });
app.get('/admin', async (req, res) => {
    try {
        const { error } = req.query;
        const botStatusPm2 = await new Promise((resolve) => {
            exec('pm2 jlist', (err, stdout) => {
                if (err) return resolve('indisponível');
                try { const processes = JSON.parse(stdout); const botProcess = processes.find(p => p.name === 'upzao-bot'); resolve(botProcess ? botProcess.pm2_env.status : 'não encontrado'); } catch (e) { resolve('indisponível'); }
            });
        });
        const settingsRows = await dbAll("SELECT chave, valor FROM configuracoes");
        const settings = settingsRows.reduce((acc, row) => ({...acc, [row.chave]: row.valor }), {});
        const contasDisponiveis = await dbAll("SELECT * FROM contas WHERE status = 'disponivel' ORDER BY nome_servico");
        const giftsDisponiveis = await dbAll("SELECT * FROM gift_cards WHERE status = 'disponivel' ORDER BY value");
        const giftsResgatados = await dbAll("SELECT * FROM gift_cards WHERE status = 'resgatado' ORDER BY redeemed_at DESC LIMIT 10");
        let statusFinal = botStatusPm2;
        let statusClass = { online: 'text-success', stopped: 'text-danger', errored: 'text-warning' }[botStatusPm2] || 'text-secondary';
        if (settings.modo_manutencao === 'ATIVO') { statusFinal = 'MANUTENÇÃO'; statusClass = 'text-warning'; }
        const statusHtml = `<span class="fw-bold text-uppercase ${statusClass}">${statusFinal}</span>`;
        const manutencaoButton = (settings.modo_manutencao === 'ATIVO') ? '<a href="/admin/manutencao/desativar" class="btn btn-success btn-sm">🟢 Desativar Manutenção</a>' : '<a href="/admin/manutencao/ativar" class="btn btn-warning btn-sm">🟡 Ativar Manutenção</a>';
        const maskToken = (token) => { if (!token || token.length < 12) return "Nenhum token configurado"; return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`; };
        const maskedToken = maskToken(settings.mp_access_token);
        let errorMessageHtml = '';
        if (error === 'codigoduplicado') {
            errorMessageHtml = `<div class="alert alert-danger" role="alert"><strong>Erro!</strong> O código personalizado que você tentou criar já existe. Por favor, escolha outro.</div>`;
        }
        let html = `
            <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Painel</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"></head>
            <body><div class="container mt-4 mb-5">
                <div class="d-flex justify-content-between align-items-center mb-4"><h1>Painel de Gerenciamento</h1><div class="d-flex gap-2"><a href="/admin/dashboard" class="btn btn-primary"><i class="bi bi-graph-up"></i> Dashboard</a><a href="#" id="theme-switcher" class="btn btn-outline-secondary"><i id="theme-icon" class="bi"></i></a><a href="/admin/logs" target="_blank" class="btn btn-info"><i class="bi bi-terminal"></i> Ver Logs</a></div></div>
                <div class="card mb-4"><div class="card-header"><h3>Controle Geral</h3></div><div class="card-body">
                    <h5 class="card-title">Status do Bot: ${statusHtml}</h5>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        ${manutencaoButton}
                        <a href="/admin/ligar-bot" class="btn btn-success"><i class="bi bi-play-fill"></i> Ligar Bot</a>
                        <a href="/admin/reiniciar-bot" class="btn btn-primary"><i class="bi bi-arrow-clockwise"></i> Reiniciar Bot</a>
                        <a href="/admin/desligar-bot" class="btn btn-danger"><i class="bi bi-stop-fill"></i> Desligar Bot</a>
                    </div><hr>
                    <h5 class="card-title mt-4">Controle do Servidor</h5>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <a href="/admin/reiniciar-servidor" class="btn btn-warning"><i class="bi bi-server"></i> Reiniciar Servidor (Aplicar Token)</a>
                        <a href="/admin/desconectar" class="btn btn-secondary" onclick="return confirm('Tem certeza?');"><i class="bi bi-power"></i> Desconectar WhatsApp</a>
                    </div>
                </div></div>
                <div class="card mb-4"><div class="card-header"><h3>Configurações Gerais</h3></div><div class="card-body">
                    <form action="/admin/salvar-config" method="POST">
                        <div class="mb-3"><label for="mp_access_token" class="form-label"><b>Mercado Pago - Access Token</b></label><input type="text" class="form-control" id="mp_access_token" name="mp_access_token" placeholder="${maskedToken}"><div class="form-text">Cole aqui o seu Access Token. Após salvar, use o botão "Reiniciar Servidor" acima.</div></div>
                        <div class="mb-3"><label for="nome_loja" class="form-label"><b>Nome da Loja</b></label><input type="text" class="form-control" id="nome_loja" name="nome_loja" value="${settings.nome_loja || ''}" required></div>
                        <div class="mb-3"><label for="template_boas_vindas" class="form-label"><b>Template da Mensagem Principal</b></label><textarea class="form-control" id="template_boas_vindas" name="template_boas_vindas" rows="6">${settings.template_boas_vindas || ''}</textarea></div>
                        <div class="mb-3"><label for="template_dados_usuario" class="form-label"><b>Template dos Dados do Usuário</b></label><textarea class="form-control" id="template_dados_usuario" name="template_dados_usuario" rows="6">${settings.template_dados_usuario || ''}</textarea><div class="form-text">Placeholders: {{nome_loja}}, {{nome}}, {{id}}, {{saldo}}, {{compras}}</div></div>
                        <hr><h5 class="mt-4">Notificador de Vencimento</h5>
                        <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" role="switch" id="notificador_ativo" name="notificador_ativo" value="ATIVO" ${settings.notificador_ativo === 'ATIVO' ? 'checked' : ''}><label class="form-check-label" for="notificador_ativo"><b>Ativar Notificador Automático</b></label></div>
                        <div class="mb-3"><label for="notificador_dias_antecedencia" class="form-label">Avisar com quantos dias de antecedência?</label><input type="number" class="form-control" id="notificador_dias_antecedencia" name="notificador_dias_antecedencia" value="${settings.notificador_dias_antecedencia || '3'}"></div>
                        <div class="mb-3"><label for="notificador_mensagem" class="form-label">Template da Mensagem de Vencimento</label><textarea class="form-control" id="notificador_mensagem" name="notificador_mensagem" rows="4">${settings.notificador_mensagem || ''}</textarea><div class="form-text">Placeholders: {{servico}}, {{data_vencimento}}</div></div>
                        <button type="submit" class="btn btn-primary w-100"><i class="bi bi-save"></i> Salvar Configurações</button>
                    </form><hr>
                    <h5>Imagem de Resgate de Gift Card</h5>
                    <div class="d-flex align-items-center gap-3">
                        <img src="/uploads/${settings.imagem_resgate}" alt="Imagem de resgate" style="width: 100px; height: 100px; object-fit: cover; border-radius: 5px;" onerror="this.src='https://via.placeholder.com/100'; this.onerror=null;">
                        <form action="/admin/upload-imagem" method="POST" enctype="multipart/form-data" class="flex-grow-1">
                            <div class="mb-3"><label for="imagem_resgate_file" class="form-label">Enviar nova imagem (PNG, JPG, GIF):</label><input class="form-control" type="file" name="imagem_resgate_file" id="imagem_resgate_file" accept="image/png, image/jpeg, image/gif"></div>
                            <button type="submit" class="btn btn-secondary btn-sm">Enviar Nova Imagem</button>
                        </form>
                    </div>
                </div></div>
                <div class="card mb-4"><div class="card-header"><h3>Gerenciador de Gift Cards</h3></div><div class="card-body">
                    ${errorMessageHtml}
                    <form action="/admin/gerar-gift" method="POST" class="row g-3 align-items-end">
                        <div class="col-sm-4"><label for="value" class="form-label">Valor (R$)</label><input type="number" step="0.01" class="form-control" id="value" name="value" placeholder="Ex: 50.00" required></div>
                        <div class="col-sm-5"><label for="custom_code" class="form-label">Código Personalizado (Opcional)</label><input type="text" class="form-control" id="custom_code" name="custom_code" placeholder="Ex: NATAL20"></div>
                        <div class="col-sm-3"><button type="submit" class="btn btn-primary w-100">Gerar Gift Card</button></div>
                    </form><hr class="my-4">
                    <h5>Disponíveis</h5><div class="table-responsive"><table class="table table-sm table-hover"><thead><tr><th>Código</th><th>Valor</th></tr></thead><tbody>`;
        giftsDisponiveis.forEach(g => { html += `<tr><td><code>${g.code}</code></td><td>R$ ${g.value.toFixed(2)}</td></tr>`; });
        html += `</tbody></table></div><h5 class="mt-4">Últimos 10 Resgatados</h5><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Código</th><th>Valor</th><th>Resgatado por (ID)</th><th>Data</th></tr></thead><tbody>`;
        giftsResgatados.forEach(g => { html += `<tr><td><s>${g.code}</s></td><td>R$ ${g.value.toFixed(2)}</td><td>${g.redeemed_by_chat_id}</td><td>${new Date(g.redeemed_at).toLocaleString('pt-BR')}</td></tr>`; });
        html += `</tbody></table></div></div></div>
                <div class="card mb-4"><div class="card-header d-flex justify-content-between align-items-center"><h3>Gerenciamento de Contas</h3><a href="/admin/adicionar-massa" class="btn btn-secondary btn-sm"><i class="bi bi-stack"></i> Adicionar por Quantidade</a></div><div class="card-body"><h5>Adicionar Nova Conta (Individual)</h5><form action="/admin/adicionar" method="POST" class="row g-3"><div class="col-md-6"><input type="text" class="form-control" name="nome_servico" placeholder="Streaming" required></div><div class="col-md-6"><input type="email" class="form-control" name="email" placeholder="Email" required></div><div class="col-md-6"><input type="text" class="form-control" name="senha" placeholder="Senha" required></div><div class="col-md-6"><input type="text" class="form-control" name="descricao" placeholder="Descrição (ex: Tela Adulto)"></div><div class="col-md-6"><input type="number" step="0.01" class="form-control" name="preco" placeholder="Valor (R$)" required></div><div class="col-md-6"><input type="number" class="form-control" name="duracao_dias" placeholder="Duração (dias)" required></div><div class="col-12"><button type="submit" class="btn btn-primary">Adicionar Conta</button></div></form><hr class="my-4"><h5 class="mt-4">Contas Disponíveis para Venda</h5><div class="table-responsive"><table class="table table-hover"><thead><tr><th>Serviço</th><th>Email</th><th>Descrição</th><th>Preço</th><th>Duração</th><th>Ações</th></tr></thead><tbody>`;
        contasDisponiveis.forEach(c => { html += `<tr><td>${c.nome_servico}</td><td>${c.email}</td><td>${c.descricao || ''}</td><td>R$ ${c.preco.toFixed(2)}</td><td>${c.duracao_dias} dias</td><td><div class="d-flex gap-2"><a href="/admin/editar/${c.id}" class="btn btn-warning btn-sm">Editar</a><form action="/admin/remover" method="POST" class="d-inline"><input type="hidden" name="id" value="${c.id}"><button type="submit" class="btn btn-danger btn-sm">Remover</button></form></div></td></tr>`; });
        html += `</tbody></table></div></div></div></div>
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                <script>
                    const themeSwitcher = document.getElementById('theme-switcher'); const themeIcon = document.getElementById('theme-icon');
                    const applyTheme = (theme) => { document.documentElement.setAttribute('data-bs-theme', theme); localStorage.setItem('theme', theme); if (themeIcon) { themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill'; } };
                    themeSwitcher.addEventListener('click', (e) => { e.preventDefault(); const currentTheme = localStorage.getItem('theme') || 'light'; const newTheme = currentTheme === 'dark' ? 'light' : 'dark'; applyTheme(newTheme); });
                    const savedTheme = localStorage.getItem('theme') || 'light'; applyTheme(savedTheme);
                </script>
            </body></html>`;
        res.send(html);
    } catch (error) {
        console.error("Erro fatal no painel admin:", error);
        res.status(500).send("Ocorreu um erro grave ao carregar o painel. Verifique os logs do servidor.");
    }
});
