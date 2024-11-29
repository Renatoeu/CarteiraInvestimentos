const db = require('../../back/database');
const cron = require('node-cron');

async function pagarDividendos() {
  console.log(`[CRON] Executando pagamento de dividendos às ${new Date().toLocaleString()}`);

  const queryAtivos = `
    SELECT user_id, asset, quantidade
    FROM inventario
    WHERE quantidade > 0
  `;

  db.all(queryAtivos, [], (err, rows) => {
    if (err) {
      console.error('[CRON] Erro ao buscar ativos para pagamento de dividendos:', err);
      return;
    }

    rows.forEach((ativo) => {
      const { user_id, asset, quantidade } = ativo;
      const porcentagem = 0.02; // 2%
      const valorDividendo = quantidade * porcentagem;

      const queryInserirDividendo = `
        INSERT INTO dividendos (user_id, asset, quantidade, valor_dividendo, data)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.run(
        queryInserirDividendo,
        [user_id, asset, quantidade, valorDividendo, new Date().toISOString()],
        (err) => {
          if (err) {
            console.error(`[CRON] Erro ao registrar dividendo para o usuário ${user_id}:`, err);
            return;
          }

          const queryAtualizarSaldo = `
            UPDATE usuarios SET saldo = saldo + ? WHERE id = ?
          `;

          db.run(queryAtualizarSaldo, [valorDividendo, user_id], (err) => {
            if (err) {
              console.error(`[CRON] Erro ao atualizar saldo para o usuário ${user_id}:`, err);
            } else {
              console.log(`[CRON] Dividendo de R$ ${valorDividendo.toFixed(2)} pago para o usuário ${user_id}`);
            }
          });
        }
      );
    });
  });
}

cron.schedule('*/10 * * * *', pagarDividendos); 

module.exports = { pagarDividendos };
