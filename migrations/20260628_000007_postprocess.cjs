/**
 * Pós-processamento e montagem de episódios.
 * - episodes: vídeo único concatenando vários finais (a "novela" completa);
 * - outputs.pos: marca um output que passou por pós-processamento (áudio/legenda/upscale).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('outputs', (t) => {
    t.boolean('pos').notNullable().defaultTo(false);
  });
  await knex.schema.createTable('episodes', (t) => {
    t.increments('id').primary();
    t.string('nome', 200).notNullable();
    t.string('path', 500).notNullable();
    t.json('output_ids_json').nullable();
    t.timestamp('criado_em').defaultTo(knex.fn.now());
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('episodes');
  await knex.schema.alterTable('outputs', (t) => t.dropColumn('pos'));
};
