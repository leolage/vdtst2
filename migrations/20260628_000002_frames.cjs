/**
 * Extração automática de frames + organização por pastas.
 *
 * Cada vídeo gerado é baixado do ComfyUI para uma pasta estruturada; uma subpasta
 * `frames/` guarda os frames extraídos (usados para montar sequência/continuidade).
 * A extração roda no servidor ComfyUI (mais parrudo que a VM do sistema).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('outputs', (t) => {
    t.enu('tipo', ['video', 'imagem']).notNullable().defaultTo('video');
    t.string('frames_dir', 500).nullable();   // subpasta com os frames extraídos
    t.integer('frames_count').notNullable().defaultTo(0);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('outputs', (t) => {
    t.dropColumn('tipo');
    t.dropColumn('frames_dir');
    t.dropColumn('frames_count');
  });
};
