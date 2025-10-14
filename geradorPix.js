// Importa a biblioteca correta e verificada
const { QrCodePix } = require('qrcode-pix');

function gerarPixCopiaECola(chave, nome, cidade, valor, idTransacao) {
    
    // Esta biblioteca cria um objeto com os dados do PIX
    const qrCodePix = QrCodePix({
        version: '01',          // Versão do payload, padrão '01'
        key: chave,             // Sua chave PIX
        name: nome,             // Seu nome ou da empresa
        city: cidade,           // Sua cidade
        transactionId: idTransacao, // ID da transação (deve ser único)
        value: valor,           // Valor da transação
    });

    // O método .payload() gera o código "Copia e Cola"
    const codigoPayload = qrCodePix.payload();

    console.log(`✅ PIX gerado com sucesso para a transação ${idTransacao}`);
    return codigoPayload;
}

// Exporta a função para o index.js
module.exports = { gerarPixCopiaECola };