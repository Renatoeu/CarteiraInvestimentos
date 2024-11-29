const express = require('express');
const db = require('./database');
const cors = require('cors');
require('../src/services/dividendoCron.js');


const app = express();
const PORT = 3000;

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'], 
}));

app.use(express.json());

// Função para gerar um token 
function gerarTokenSimples() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Registro de usuário
app.post('/registro', (req, res) => {
  const { nome, email, senha } = req.body;
  const query = `INSERT INTO usuarios (nome, email, senha, saldo) VALUES (?, ?, ?, ?)`;

  db.run(query, [nome, email, senha, 0.0], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Erro ao registrar usuário' });
    }
    const token = gerarTokenSimples();
    res.status(201).json({ token, userId: this.lastID });
  });
});

// Login
app.post('/login', (req, res) => {
  const { email, senha } = req.body;
  db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], (err, usuario) => {
    if (err || !usuario || usuario.senha !== senha) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    const token = gerarTokenSimples();
    res.json({
      token,
      userId: usuario.id,
      saldo: usuario.saldo
    });
  });
});

// Atualizar o saldo no banco de dados
const atualizarSaldo = (userId, valor, operacao) => {
  return new Promise((resolve, reject) => {

    const dataTransacao = new Date().toISOString();
    const tipoTransacao = operacao === 'depositar' ? 'deposito' : 'retirada';

    const queryTransacao = `
      INSERT INTO transacoes (user_id, tipo, valor, quantidade, data)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.run(queryTransacao, [userId, tipoTransacao, valor, 1, dataTransacao], function (err) {
      if (err) {
        console.error("Erro ao registrar transação:", err);
        return reject('Erro ao registrar transação');
      }

      console.log('Transação registrada com sucesso!');
      resolve();
    });
  });
};

// Atualizar o saldo
app.post('/atualizarSaldo', async (req, res) => {
  const { userId, valor, operacao } = req.body;

  if (isNaN(valor) || valor <= 0) {
    return res.status(400).json({ error: 'Valor inválido' });
  }

  try {
    const novoSaldo = await atualizarSaldo(userId, parseFloat(valor), operacao);
    res.status(200).json({ message: 'Saldo atualizado com sucesso', saldo: novoSaldo });
  } catch (error) {
    res.status(500).json({ error: error });
  }
});

// Obter saldo
app.post('/getSaldo', (req, res) => {
  const { userId } = req.body;
  db.get('SELECT saldo FROM usuarios WHERE id = ?', [userId], (err, row) => {
    if (err || !row) {
      return res.status(500).json({ message: 'Erro ao recuperar saldo' });
    }
    res.json({ saldo: row.saldo });
  });
});

// Histórico de transações
app.get('/getHistoricoTransacoes', (req, res) => {
  const { userId } = req.query;

  console.log('User ID recebido na API:', userId);

  if (!userId) {
    return res.status(400).json({ message: 'User ID é necessário' });
  }

  const query = `
    SELECT tipo, quantidade, valor, nome_acao, data 
    FROM transacoes 
    WHERE user_id = ? 
    ORDER BY data DESC
  `;

  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error('Erro ao executar a consulta:', err);
      return res.status(500).json({ message: 'Erro ao recuperar histórico de transações' });
    }

    console.log('Transações recuperadas:', rows);
    res.json(rows);
  });
});

//Coletar açoes do usuario
app.get('/getUserAssets', async (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ message: 'ID de usuário não fornecido.' });
  }

  const query = 'SELECT asset, nome_acao, quantidade, valor_unitario FROM inventario WHERE user_id = ?';

  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar ações do usuário:', err);
      return res.status(500).json({ message: 'Erro ao buscar ações do usuário.' });
    }

    const ativosComValorTotal = rows.map((ativo) => ({
      ...ativo,
      valor_total: ativo.quantidade * ativo.valor_unitario,
    }));

    res.status(200).json(ativosComValorTotal);
  });
});

//Comprar Açao
app.post('/comprarAcao', async (req, res) => {
  const { userId, asset, nome_acao, quantidade, valor } = req.body;

  if (!userId || !asset || !nome_acao || isNaN(quantidade) || isNaN(valor) || quantidade <= 0 || valor <= 0) {
    return res.status(400).json({ message: 'Dados inválidos para a compra' });
  }

  console.log('Dados recebidos para compra:', { userId, asset, nome_acao, quantidade, valor });

  try {
    const custoTotal = quantidade * valor;

    const queryVerificarSaldo = 'SELECT saldo FROM usuarios WHERE id = ?';
    db.get(queryVerificarSaldo, [userId], (err, row) => {
      if (err) {
        console.error('Erro ao verificar saldo:', err);
        return res.status(500).json({ message: 'Erro ao verificar saldo' });
      }

      if (!row || row.saldo < custoTotal) {
        return res.status(400).json({ message: 'Saldo insuficiente para realizar a compra' });
      }

      const dataTransacao = new Date().toISOString();
      const tipoTransacao = 'compra';

      const queryTransacao = `
        INSERT INTO transacoes (user_id, tipo, valor, quantidade, nome_acao, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.run(queryTransacao, [userId, tipoTransacao, custoTotal, quantidade, nome_acao, dataTransacao], function (err) {
        if (err) {
          console.error('Erro ao registrar transação de compra:', err);
          return res.status(500).json({ message: 'Erro ao registrar transação de compra' });
        }

        const queryInventario = `
          INSERT INTO inventario (user_id, asset, nome_acao, quantidade, valor_unitario)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, asset) 
          DO UPDATE SET 
            quantidade = quantidade + excluded.quantidade,
            nome_acao = excluded.nome_acao,
            valor_unitario = excluded.valor_unitario
        `;
        db.run(queryInventario, [userId, asset, nome_acao, quantidade, valor], function (err) {
          if (err) {
            console.error('Erro ao adicionar ao inventário:', err);
            return res.status(500).json({ message: 'Erro ao adicionar ao inventário' });
          }

          const queryAtualizarSaldo = 'UPDATE usuarios SET saldo = saldo - ? WHERE id = ?';
          db.run(queryAtualizarSaldo, [custoTotal, userId], function (err) {
            if (err) {
              console.error('Erro ao atualizar saldo:', err);
              return res.status(500).json({ message: 'Erro ao atualizar saldo' });
            }
            console.log('Compra registrada com sucesso');
            res.status(201).json({ message: 'Compra registrada com sucesso' });
          });
        });
      });
    });
  } catch (error) {
    console.error('Erro ao registrar compra:', error);
    res.status(500).json({ error: 'Erro ao registrar compra' });
  }
});

// Verder Açao
app.post('/venderAcao', async (req, res) => {
  const { userId, asset, quantidade, valor } = req.body;

  if (!userId || !asset || isNaN(quantidade) || isNaN(valor) || quantidade <= 0 || valor <= 0) {
    return res.status(400).json({ message: 'Dados inválidos para a venda' });
  }

  const queryInventario = `
    SELECT quantidade, nome_acao FROM inventario WHERE user_id = ? AND asset = ?
  `;
  db.get(queryInventario, [userId, asset], async (err, row) => {
    if (err) {
      console.error('Erro ao verificar inventário:', err);
      return res.status(500).json({ message: 'Erro ao verificar inventário' });
    }

    if (!row || row.quantidade < quantidade) {
      return res.status(400).json({ message: 'Quantidade insuficiente de ações para realizar a venda' });
    }

    const nomeAcao = row.nome_acao;
    const receitaTotal = quantidade * valor;

    try {
      const dataTransacao = new Date().toISOString();
      const tipoTransacao = 'venda';

      const queryTransacao = `
        INSERT INTO transacoes (user_id, tipo, valor, quantidade, nome_acao, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      db.run(queryTransacao, [userId, tipoTransacao, receitaTotal, quantidade, nomeAcao, dataTransacao], function (err) {
        if (err) {
          console.error('Erro ao registrar transação de venda:', err);
          return res.status(500).json({ message: 'Erro ao registrar transação de venda' });
        }

        const queryUpdateInventario = `
          UPDATE inventario
          SET quantidade = quantidade - ?
          WHERE user_id = ? AND asset = ?
        `;
        db.run(queryUpdateInventario, [quantidade, userId, asset], function (err) {
          if (err) {
            console.error('Erro ao atualizar inventário:', err);
            return res.status(500).json({ message: 'Erro ao atualizar inventário' });
          }

          const queryRemoverAtivo = `
            DELETE FROM inventario WHERE user_id = ? AND asset = ? AND quantidade <= 0
          `;
          db.run(queryRemoverAtivo, [userId, asset], function (err) {
            if (err) {
              console.error('Erro ao remover ativo do inventário:', err);
              return res.status(500).json({ message: 'Erro ao remover ativo do inventário' });
            }

            const querySaldo = 'UPDATE usuarios SET saldo = saldo + ? WHERE id = ?';
            db.run(querySaldo, [receitaTotal, userId], function (err) {
              if (err) {
                console.error('Erro ao atualizar saldo:', err);
                return res.status(500).json({ message: 'Erro ao atualizar saldo' });
              }
              res.status(200).json({ message: 'Venda registrada com sucesso' });
            });
          });
        });
      });
    } catch (error) {
      console.error('Erro ao registrar a venda:', error);
      res.status(500).json({ error: 'Erro ao registrar a venda' });
    }
  });
});


//Resgatar Dividendos
app.get('/getDividendos', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'ID do usuário é necessário' });
  }

  const query = `
    SELECT asset, quantidade, valor_dividendo AS valor, data 
    FROM dividendos 
    WHERE user_id = ? 
    ORDER BY data DESC
  `;

  db.all(query, [userId], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar dividendos:', err);
      return res.status(500).json({ message: 'Erro ao buscar dividendos' });
    }

    res.json(rows || []);
  });
});

//Resgatar Rentabilidade (Nao Funcional)
app.get('/getRentabilidadeMensal', async (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ error: 'ID do usuário não fornecido.' });
  }

  try {
    const query = `SELECT asset, quantidade, valor_unitario FROM inventario WHERE user_id = ? AND quantidade > 0`;
    db.all(query, [userId], (err, rows) => {
      if (err) {
        console.error('Erro ao buscar ativos do inventário:', err);
        return res.status(500).json({ error: 'Erro ao buscar ativos do inventário.' });
      }

      if (!rows.length) {
        return res.status(200).json({ ativos: [] });
      }

      const ativos = rows.map((ativo) => ({
        asset: ativo.asset,
        quantidade: ativo.quantidade,
        valor_unitario: ativo.valor_unitario,
      }));

      res.status(200).json({ ativos });
    });
  } catch (error) {
    console.error('Erro ao processar rentabilidade:', error);
    res.status(500).json({ error: 'Erro ao processar rentabilidade.' });
  }
});

app.get('/getDashboardData', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'ID do usuário é necessário.' });
  }

  const queryEvolucaoSaldo = `
    SELECT 
      t.id AS transacao_id,
      t.tipo,
      t.valor,
      (
        SELECT saldo 
        FROM usuarios 
        WHERE id = ?
      ) AS saldo_final,
      (
        SELECT SUM(
          CASE 
            WHEN tipo = 'deposito' THEN valor
            WHEN tipo = 'retirada' THEN -valor
            ELSE 0
          END
        ) 
        FROM transacoes
        WHERE user_id = t.user_id AND t.id >= id
      ) AS saldo_acumulado
    FROM transacoes t
    WHERE t.user_id = ?
    ORDER BY t.id ASC
  `;

  const queryDividendos = `
    SELECT 
      d.id AS transacao_id,
      SUM(d.valor_dividendo) OVER (ORDER BY d.data ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS dividendos_acumulados
    FROM dividendos d
    WHERE d.user_id = ?
    ORDER BY d.data ASC
  `;

  const fetchData = (query, params) =>
    new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

  Promise.all([
    fetchData(queryEvolucaoSaldo, [userId, userId]),
    fetchData(queryDividendos, [userId]), 
  ])
    .then(([saldoData, dividendosData]) => {
      const saldoFinal = saldoData[0]?.saldo_final || 0;
      const valoresCorrigidos = saldoData.map((row, index, array) => ({
        ...row,
        saldo_acumulado: saldoFinal - (array[array.length - 1]?.saldo_acumulado - row.saldo_acumulado),
      }));

      const formatData = (data, valueKey) => ({
        labels: Array(data.length).fill(''), 
        valores: data.map((row) => parseFloat(row[valueKey] || 0)),
      });

      res.json({
        saldo: formatData(valoresCorrigidos, 'saldo_acumulado'), 
        dividendos: formatData(dividendosData, 'dividendos_acumulados'), 
      });
    })
    .catch((err) => {
      console.error('Erro ao buscar dados do dashboard:', err);
      res.status(500).json({ message: 'Erro ao buscar dados do dashboard.' });
    });
});


app.get('/getEstatisticas', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'ID do usuário é necessário' });
  }

  const queries = {
    totalDepositos: `
      SELECT COUNT(*) AS quantidade, SUM(valor) AS total
      FROM transacoes
      WHERE user_id = ? AND tipo = 'deposito'
    `,
    totalRetiradas: `
      SELECT COUNT(*) AS quantidade, SUM(valor) AS total
      FROM transacoes
      WHERE user_id = ? AND tipo = 'retirada'
    `,
    totalCompras: `
      SELECT COUNT(*) AS quantidade, SUM(valor) AS total
      FROM transacoes
      WHERE user_id = ? AND tipo = 'compra'
    `,
    totalVendas: `
      SELECT COUNT(*) AS quantidade, SUM(valor) AS total
      FROM transacoes
      WHERE user_id = ? AND tipo = 'venda'
    `,
    totalDividendos: `
      SELECT SUM(valor_dividendo) AS total
      FROM dividendos
      WHERE user_id = ?
    `,
    saldoAtual: `
      SELECT saldo
      FROM usuarios
      WHERE id = ?
    `,
  };

  const fetchData = (query, params) =>
    new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

  Promise.all([
    fetchData(queries.totalDepositos, [userId]),
    fetchData(queries.totalRetiradas, [userId]),
    fetchData(queries.totalCompras, [userId]),
    fetchData(queries.totalVendas, [userId]),
    fetchData(queries.totalDividendos, [userId]),
    fetchData(queries.saldoAtual, [userId]),
  ])
    .then(([depositos, retiradas, compras, vendas, dividendos, saldoAtual]) => {
      res.json({
        depositos,
        retiradas,
        compras,
        vendas,
        dividendos: dividendos?.total || 0,
        saldoAtual: saldoAtual?.saldo || 0, 
      });
    })
    .catch((err) => {
      console.error('Erro ao buscar estatísticas:', err.message || err);
      res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
    });
});



app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
