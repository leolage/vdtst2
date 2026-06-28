/**
 * Catálogo (nota/observação por trabalho) + encadeamento por frame golden.
 *
 * - jobs.nota / jobs.observacao: catálogo do que deu certo e do que não deu.
 * - outputs.golden: marca uma cena/resultado perfeito.
 * - images.origem_output_id / origem_frame: linhagem de uma imagem da biblioteca que
 *   nasceu de um frame de um vídeo golden (encadeamento de cenas).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.tinyint('nota').nullable();           // 1..5 (qualidade do resultado)
    t.text('observacao').nullable();        // o que deu certo / o que não deu
  });

  await knex.schema.alterTable('outputs', (t) => {
    t.boolean('golden').notNullable().defaultTo(false);
  });

  await knex.schema.alterTable('images', (t) => {
    t.integer('origem_output_id').unsigned().nullable().references('id').inTable('outputs').onDelete('SET NULL');
    t.string('origem_frame', 200).nullable(); // nome do frame promovido (ex.: frame-0042.png)
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('images', (t) => {
    t.dropColumn('origem_output_id');
    t.dropColumn('origem_frame');
  });
  await knex.schema.alterTable('outputs', (t) => {
    t.dropColumn('golden');
  });
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('nota');
    t.dropColumn('observacao');
  });
};
