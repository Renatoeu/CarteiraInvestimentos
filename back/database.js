const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'carteira_investimentos.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      saldo REAL DEFAULT 0.0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      tipo TEXT NOT NULL,  -- 'compra', 'venda', 'deposito', 'retirada'
      valor REAL NOT NULL,
      quantidade INTEGER,
      data TEXT NOT NULL,  -- Data e hora da transação
      FOREIGN KEY(user_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS atualizar_saldo AFTER INSERT ON transacoes
    BEGIN
      UPDATE usuarios
      SET saldo = saldo + (CASE 
        WHEN NEW.tipo = 'deposito' THEN NEW.valor
        WHEN NEW.tipo = 'retirada' THEN -NEW.valor
        ELSE 0
      END)
      WHERE id = NEW.user_id;
    END;
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inventario (
      user_id INTEGER,
      asset TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, asset),
      FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS dividendos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  asset TEXT NOT NULL,
  quantidade INTEGER,
  valor_dividendo REAL NOT NULL,
  data TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
  `);

});


module.exports = db;