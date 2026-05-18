# UDP Telemetry Dashboard

Dashboard web para visualizar telemetria UDP enviada por dos dispositivos externos.

Formato esperado del mensaje UDP:

```json
{"device_id":"device_1","key":"rotation","value":24.7}
```

Dispositivos aceptados:

- `device_1`
- `device_2`

## Ejecutar localmente

Requisitos:

- Node.js 18 o superior

Arranque:

```bash
npm start
```

Servicios:

- Dashboard HTTP: `http://localhost:3000`
- Receptor UDP: `0.0.0.0:5005`

Enviar mensajes de prueba:

```bash
npm run send:test:device1
npm run send:test:device2
```

Tambien puedes enviar un paquete UDP manualmente:

```bash
node scripts/send-udp-test.js device_1 rotation 24.7 127.0.0.1 5005
```

## Variables de entorno

```bash
HTTP_HOST=0.0.0.0
HTTP_PORT=3000
UDP_HOST=0.0.0.0
UDP_PORT=5005
MAX_HISTORY=500
ONLINE_TIMEOUT_MS=30000
```

## Despliegue en EC2

### 1. Security Group en AWS

En la consola de AWS → EC2 → Security Groups, abre estos puertos:

| Tipo | Puerto | Origen |
|------|--------|--------|
| TCP  | 80     | `0.0.0.0/0` (dashboard público) |
| TCP  | 22     | Tu IP (solo SSH) |
| UDP  | 5005   | IPs públicas de tus dispositivos |

### 2. Conectarse a la EC2

```bash
ssh -i "tu-key.pem" ubuntu@<IP-EC2>
```

### 3. Instalar Node.js 20, Nginx y PM2

> ⚠️ No usar `apt install nodejs` directamente — instala una versión antigua. Usar NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm install -g pm2
```

Verificar versión:

```bash
node --version   # debe ser v20.x
```

### 4. Subir el proyecto a la EC2

**Opción A — desde GitHub:**

```bash
cd /opt
sudo git clone https://github.com/tu-usuario/tu-repo.git udp-telemetry-dashboard
sudo chown -R ubuntu:ubuntu /opt/udp-telemetry-dashboard
cd /opt/udp-telemetry-dashboard
```

**Opción B — con SCP desde tu máquina local:**

```bash
scp -i "tu-key.pem" -r ./backend ubuntu@<IP-EC2>:/opt/udp-telemetry-dashboard
```

### 5. Arrancar con PM2

```bash
cd /opt/udp-telemetry-dashboard
pm2 start server.js --name udp-telemetry-dashboard
```

Configurar arranque automático al reiniciar la EC2:

```bash
pm2 startup
# PM2 imprime un comando sudo — copiarlo y ejecutarlo manualmente, por ejemplo:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save
```

### 6. Configurar Nginx

Crear el archivo de configuracion:

```bash
sudo nano /etc/nginx/sites-available/telemetry
```

Pegar el siguiente contenido:

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
    }
}
```

> `proxy_buffering off` y `proxy_set_header Connection ''` son necesarios para que
> el stream de eventos en tiempo real (SSE) funcione correctamente a traves de Nginx.

Activar la config y eliminar la default:

```bash
sudo ln -s /etc/nginx/sites-available/telemetry /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Verificar que todo funciona

```bash
# Ver logs en tiempo real
pm2 logs udp-telemetry-dashboard

# Enviar un mensaje de prueba desde la propia EC2
node scripts/send-udp-test.js device_1 rotation 24.7 127.0.0.1 5005
```

Abrir `http://<IP-EC2>` en el navegador — el dashboard debe mostrar el mensaje recibido.

### 8. HTTPS con dominio propio (opcional)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```
