/**
 * Encadeamento automático de segmentos.
 *
 * - status 'waiting': segmento aguardando o predecessor (invisível ao agente/worker
 *   até ser liberado com o frame de continuidade);
 * - jobs.chain_key: agrupa os segmentos de uma mesma combinação (cena×prompt×imagem);
 * - jobs.depende_de: id do segmento anterior;
 * - scenes.encadear: liga/desliga o encadeamento (default ligado);
 * - outputs.is_final: marca o vídeo concatenado final da cadeia.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.raw(
    "ALTER TABLE jobs MODIFY COLUMN status " +
      "ENUM('queued','blocked','running','done','error','waiting') NOT NULL DEFAULT 'queued'",
  );
  await knex.schema.alterTable('jobs', (t) => {
    t.string('chain_key', 80).nullable();
    t.integer('depende_de').unsigned().nullable();
    t.index('chain_key');
    t.index('depende_de');
  });
  await knex.schema.alterTable('scenes', (t) => {
    t.boolean('encadear').notNullable().defaultTo(true);
  });
  await knex.schema.alterTable('outputs', (t) => {
    t.boolean('is_final').notNullable().defaultTo(false);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('outputs', (t) => t.dropColumn('is_final'));
  await knex.schema.alterTable('scenes', (t) => t.dropColumn('encadear'));
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('chain_key');
    t.dropColumn('depende_de');
  });
  await knex.raw(
    "ALTER TABLE jobs MODIFY COLUMN status " +
      "ENUM('queued','blocked','running','done','error') NOT NULL DEFAULT 'queued'",
  );
};
