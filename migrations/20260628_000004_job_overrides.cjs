/**
 * Reenvio com ajustes (debug).
 *
 * jobs.overrides_json guarda overrides pontuais aplicados sobre a base da cena/prompt
 * (texto do prompt, loras, frames/fps, troca de imagem) — usado pela tela de detalhe do
 * vídeo para "mudar algo e enviar de novo". params_json (já existente) recebe o snapshot
 * resolvido na execução, para auditoria/debug.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.json('overrides_json').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('overrides_json');
  });
};
