# Deploy na VM (Linux, sem Docker)

Alvo: VM em LAN, MariaDB local, nginx local, acesso externo por Cloudflare Tunnel.

## 1. Dependências do sistema
```bash
sudo apt update
sudo apt install -y nodejs npm mariadb-server nginx ffmpeg
# cloudflared: baixe o .deb oficial da Cloudflare e instale com dpkg -i
```
Garanta Node >= 20 (`node -v`). Se o repositório da distro trouxer versão antiga, use
o NodeSource ou nvm.

## 2. Banco de dados
```bash
sudo mysql -e "CREATE DATABASE wan_studio CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'wan'@'localhost' IDENTIFIED BY 'senha-do-banco';"
sudo mysql -e "GRANT ALL ON wan_studio.* TO 'wan'@'localhost'; FLUSH PRIVILEGES;"
```

## 3. Aplicação
```bash
sudo useradd -r -m -d /opt/wan-studio wan      # usuário de serviço
sudo -u wan git clone <repo> /opt/wan-studio
cd /opt/wan-studio
sudo -u wan npm ci
sudo -u wan cp .env.example .env
sudo -u wan nano .env        # DB_*, SESSION_SECRET (openssl rand -hex 32), SESSION_SECURE=true
sudo -u wan npm run build
sudo -u wan npm run migrate
sudo -u wan npm run create-user -- admin 'suaSenhaForte'

sudo mkdir -p /var/lib/wan-studio/{inputs,outputs}
sudo chown -R wan:wan /var/lib/wan-studio
```

## 4. Serviços systemd
```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wan-web wan-worker wan-agent
sudo systemctl status wan-web
```

## 5. nginx local
```bash
sudo cp deploy/nginx/wan-studio.conf /etc/nginx/sites-available/wan-studio
sudo ln -s /etc/nginx/sites-available/wan-studio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Cloudflare Tunnel
```bash
cloudflared tunnel login
cloudflared tunnel create wan-studio
cloudflared tunnel route dns wan-studio wan.seudominio.com
sudo cp deploy/cloudflared/config.yml.example /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml     # ajuste hostname e credentials-file
sudo systemctl enable --now wan-tunnel
```
Acesse `https://wan.seudominio.com`. Recomendado ativar **Cloudflare Access** (Zero
Trust) exigindo seu e-mail antes do login da aplicação.

## 7. Nós ComfyUI remotos (Fase 4)
Cada servidor WAN é cadastrado com `ssh_host`, `ssh_port`, `ssh_user`, chave SSH e
`comfy_port`. O worker abre túnel `ssh -L` para falar com a API do ComfyUI; o agente usa
SSH para `nvidia-smi`, reiniciar o ComfyUI e ler logs. A chave SSH é guardada cifrada
at-rest (`SSH_KEY_ENCRYPTION_KEY` no `.env`).

A extração de frames roda no próprio servidor ComfyUI (`FRAME_EXTRACT_ON_NODE=true`),
então **instale `ffmpeg` em cada host ComfyUI** além da VM do sistema.

Cadastre os servidores pela UI em **`/nodes.html`** (nome, host/porta SSH, usuário,
porta do ComfyUI, `max_concurrent` e a chave privada SSH — cifrada at-rest). É obrigatório
definir `SSH_KEY_ENCRYPTION_KEY` no `.env` antes de cadastrar. Use **testar agora** para
validar a conexão e popular VRAM/LoRAs/checkpoints. O agente revalida a saúde
periodicamente (`AGENT_HEALTH_MS`).

## Atualizações
```bash
cd /opt/wan-studio
sudo -u wan git pull
sudo -u wan npm ci && sudo -u wan npm run build && sudo -u wan npm run migrate
sudo systemctl restart wan-web wan-worker wan-agent
```
