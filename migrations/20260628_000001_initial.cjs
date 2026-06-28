/**
 * Schema inicial do WAN Studio.
 * Cobre todo o modelo de domínio para as fases seguintes evoluírem sem churn.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('login', 64).notNullable().unique();
    t.string('senha_hash', 255).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('projects', (t) => {
    t.increments('id').primary();
    t.string('nome', 200).notNullable();
    t.json('workflow_json').nullable();
    t.json('node_bindings_json').nullable();
    t.enu('status', ['rascunho', 'pronto', 'arquivado']).notNullable().defaultTo('rascunho');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('image_categories', (t) => {
    t.increments('id').primary();
    t.string('nome', 120).notNullable().unique();
    t.string('descricao', 500).nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('images', (t) => {
    t.increments('id').primary();
    t.integer('category_id').unsigned().references('id').inTable('image_categories').onDelete('SET NULL');
    t.string('path', 500).notNullable();      // CONTEÚDO — nunca vai ao agente
    t.string('thumb_path', 500).nullable();
    t.json('tags_json').nullable();
    t.timestamps(true, true);
    t.index('category_id');
  });

  await knex.schema.createTable('scenes', (t) => {
    t.increments('id').primary();
    t.integer('project_id').unsigned().notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('nome', 200).notNullable();
    t.integer('ordem').notNullable().defaultTo(0);
    t.integer('categoria_id').unsigned().references('id').inTable('image_categories').onDelete('SET NULL');
    t.integer('segmentos').notNullable().defaultTo(1);
    t.float('dur_segmento').notNullable().defaultTo(5); // segundos
    t.timestamps(true, true);
    t.index(['project_id', 'ordem']);
  });

  await knex.schema.createTable('scene_loras', (t) => {
    t.increments('id').primary();
    t.integer('scene_id').unsigned().notNullable().references('id').inTable('scenes').onDelete('CASCADE');
    t.string('lora_nome', 255).notNullable();
    t.float('peso').notNullable().defaultTo(1.0);
    t.index('scene_id');
  });

  await knex.schema.createTable('prompts', (t) => {
    t.increments('id').primary();
    t.integer('scene_id').unsigned().notNullable().references('id').inTable('scenes').onDelete('CASCADE');
    t.text('texto_pos').notNullable();   // CONTEÚDO — nunca vai ao agente
    t.text('texto_neg').nullable();      // CONTEÚDO — nunca vai ao agente
    t.integer('ordem').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('scene_id');
  });

  await knex.schema.createTable('scene_images', (t) => {
    t.increments('id').primary();
    t.integer('scene_id').unsigned().notNullable().references('id').inTable('scenes').onDelete('CASCADE');
    t.integer('image_id').unsigned().notNullable().references('id').inTable('images').onDelete('CASCADE');
    t.unique(['scene_id', 'image_id']);
    t.index('scene_id');
  });

  await knex.schema.createTable('comfy_nodes', (t) => {
    t.increments('id').primary();
    t.string('nome', 120).notNullable();
    t.string('ssh_host', 255).notNullable();
    t.integer('ssh_port').notNullable().defaultTo(22);
    t.string('ssh_user', 64).notNullable();
    t.string('ssh_key_ref', 255).nullable();   // referência ao segredo cifrado
    t.integer('comfy_port').notNullable().defaultTo(8188);
    t.enu('status', ['up', 'down', 'paused']).notNullable().defaultTo('down');
    t.integer('max_concurrent').notNullable().defaultTo(1);
    t.bigInteger('vram_total').nullable();
    t.bigInteger('vram_free').nullable();
    t.integer('queue_len').notNullable().defaultTo(0);
    t.json('modelos_json').nullable();
    t.json('loras_json').nullable();
    t.timestamp('ultimo_health').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('jobs', (t) => {
    t.increments('id').primary();
    t.integer('project_id').unsigned().notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.integer('scene_id').unsigned().notNullable().references('id').inTable('scenes').onDelete('CASCADE');
    t.integer('prompt_id').unsigned().references('id').inTable('prompts').onDelete('SET NULL');
    t.integer('image_id').unsigned().references('id').inTable('images').onDelete('SET NULL');
    t.integer('segmento_idx').notNullable().defaultTo(0);
    t.json('params_json').nullable();
    t.enu('status', ['queued', 'blocked', 'running', 'done', 'error']).notNullable().defaultTo('queued');
    t.integer('prioridade').notNullable().defaultTo(100);
    t.integer('node_id').unsigned().references('id').inTable('comfy_nodes').onDelete('SET NULL');
    t.string('comfy_prompt_id', 100).nullable();
    t.string('output_path', 500).nullable();
    t.string('erro_categoria', 40).nullable();
    t.text('traceback').nullable();
    t.integer('tentativas').notNullable().defaultTo(0);
    t.timestamp('agendado_para').nullable();
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.timestamp('iniciado_em').nullable();
    t.timestamp('terminado_em').nullable();
    t.index(['status', 'prioridade', 'agendado_para']);
    t.index('scene_id');
  });

  await knex.schema.createTable('schedules', (t) => {
    t.increments('id').primary();
    t.integer('project_id').unsigned().notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.json('regra_json').notNullable();
    t.boolean('ativo').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('outputs', (t) => {
    t.increments('id').primary();
    t.integer('job_id').unsigned().references('id').inTable('jobs').onDelete('SET NULL');
    t.integer('scene_id').unsigned().references('id').inTable('scenes').onDelete('CASCADE');
    t.string('path', 500).notNullable();
    t.string('thumb_path', 500).nullable();
    t.boolean('aprovado').nullable(); // null = pendente de revisão
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.index('scene_id');
  });

  await knex.schema.createTable('agent_decisions', (t) => {
    t.increments('id').primary();
    t.string('acao', 40).notNullable();
    t.json('alvo_json').nullable();
    t.text('motivo').nullable();
    t.integer('custo_tokens').nullable();
    t.timestamp('criado_em').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('agent_events', (t) => {
    t.increments('id').primary();
    t.string('tipo', 40).notNullable();
    t.text('mensagem').nullable();
    t.integer('job_id').unsigned().nullable();
    t.timestamp('criado_em').defaultTo(knex.fn.now());
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  for (const table of [
    'agent_events', 'agent_decisions', 'outputs', 'schedules', 'jobs',
    'comfy_nodes', 'scene_images', 'prompts', 'scene_loras', 'scenes',
    'images', 'image_categories', 'projects', 'users',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};
