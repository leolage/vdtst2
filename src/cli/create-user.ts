/**
 * Cria/atualiza o usuário único de login.
 * Uso: npm run create-user -- <login> <senha>
 */
import bcrypt from 'bcryptjs';
import { db, closeDb } from '../db/knex.js';

async function main() {
  const [login, senha] = process.argv.slice(2);
  if (!login || !senha) {
    console.error('Uso: npm run create-user -- <login> <senha>');
    process.exit(1);
  }
  const senha_hash = await bcrypt.hash(senha, 10);
  const existing = await db()('users').where({ login }).first();
  if (existing) {
    await db()('users').where({ id: existing.id }).update({ senha_hash });
    console.log(`Senha atualizada para o usuário "${login}".`);
  } else {
    await db()('users').insert({ login, senha_hash });
    console.log(`Usuário "${login}" criado.`);
  }
  await closeDb();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
