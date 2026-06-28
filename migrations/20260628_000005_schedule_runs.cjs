/**
 * Agendamento: rastrear a última e a próxima execução de cada schedule.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('schedules', (t) => {
    t.string('nome', 200).nullable();
    t.timestamp('ultimo_run').nullable();
    t.timestamp('proximo_run').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('schedules', (t) => {
    t.dropColumn('nome');
    t.dropColumn('ultimo_run');
    t.dropColumn('proximo_run');
  });
};
